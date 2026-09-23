import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { A2UIContext, V1Surface } from './A2UIRenderer'
import { A2UIRuntime } from './runtime'
import { BASIC_CATALOG_ID, basicCatalog, type JsonMap } from './schema'

const event = { event: { name: 'save', context: { name: { path: '/name' } } } }
function mount(components: JsonMap[], dataModel: JsonMap = {}) {
  const runtime = new A2UIRuntime()
  runtime.onSend = vi.fn()
  runtime.process({ version: 'v1.0', createSurface: { surfaceId: 'form', catalogId: BASIC_CATALOG_ID, sendDataModel: true, components, dataModel } }, 'fixture')
  expect(runtime.errors).toEqual([])
  const view = render(<A2UIContext.Provider value={runtime}><V1Surface surfaceId="form" /></A2UIContext.Provider>)
  return { runtime, ...view }
}
describe('basic catalog DOM behavior', () => {
  test('implements all 18 catalog components with working bound inputs, tabs, and modal', async () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
    const components: JsonMap[] = [
      { id: 'root', component: 'Column', children: ['row', 'list', 'card', 'tabs', 'divider', 'modal', 'button', 'check', 'field', 'date', 'choice', 'slider', 'image', 'icon', 'video', 'audio'] },
      { id: 'text', component: 'Text', text: 'Catalog text' },
      { id: 'row', component: 'Row', children: ['text'] },
      { id: 'list', component: 'List', children: { path: '/items', componentId: 'item' } },
      { id: 'item', component: 'Text', text: { path: 'title' } },
      { id: 'card', component: 'Card', child: 'text' },
      { id: 'tabs', component: 'Tabs', tabs: [{ title: 'First', child: 'text' }, { title: 'Second', child: 'second' }] },
      { id: 'second', component: 'Text', text: 'Second panel' },
      { id: 'divider', component: 'Divider' },
      { id: 'modal', component: 'Modal', trigger: 'trigger', content: 'modalText', accessibility: { label: 'Details' } },
      { id: 'trigger', component: 'Button', child: 'triggerLabel', action: { event: { name: 'must-not-send' } } },
      { id: 'triggerLabel', component: 'Text', text: 'Show details' },
      { id: 'modalText', component: 'Text', text: 'Dialog content' },
      { id: 'button', component: 'Button', child: 'buttonLabel', action: event, checks: [{ condition: { call: 'required', args: { value: { path: '/name' } } } }] },
      { id: 'buttonLabel', component: 'Text', text: 'Save form' },
      { id: 'check', component: 'CheckBox', label: 'Enabled', value: { path: '/enabled' } },
      { id: 'field', component: 'TextField', label: 'Name', value: { path: '/name' }, accessibility: { description: 'Your display name' } },
      { id: 'date', component: 'DateTimeInput', label: 'Date', enableDate: true, value: { path: '/date' } },
      { id: 'choice', component: 'ChoicePicker', label: 'Region', options: [{ label: 'West', value: 'west' }, { label: 'East', value: 'east' }], variant: 'multipleSelection', value: { path: '/choices' }, filterable: true, displayStyle: 'chips' },
      { id: 'slider', component: 'Slider', label: 'Volume', min: 0, max: 100, steps: 10, value: { path: '/volume' } },
      { id: 'image', component: 'Image', url: '/fixture.png', description: 'Fixture image' },
      { id: 'icon', component: 'Icon', name: 'check', accessibility: { label: 'Complete' } },
      { id: 'video', component: 'Video', url: '/fixture.mp4', posterUrl: '/fixture.png' },
      { id: 'audio', component: 'AudioPlayer', url: '/fixture.mp3', description: 'Fixture audio' },
    ]
    const { runtime, container } = mount(components, { name: '', enabled: false, date: '', choices: [], volume: 20, items: [{ title: 'Scoped one' }, { title: 'Scoped two' }] })
    for (const name of Object.keys(basicCatalog.components)) expect(container.querySelector('.a2v1-' + name), name).not.toBeNull()
    expect(screen.getByText('Scoped two')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save form' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Grace' } })
    fireEvent.click(screen.getByLabelText('Enabled'))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-18' } })
    fireEvent.click(screen.getByRole('button', { name: 'West' }))
    fireEvent.change(screen.getByLabelText('Volume'), { target: { value: '40' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save form' })).toBeEnabled())
    expect(runtime.surfaces.get('form')?.data).toMatchObject({ name: 'Grace', enabled: true, date: '2026-09-18', choices: ['west'], volume: 40 })
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Your display name')
    fireEvent.click(screen.getByRole('tab', { name: 'Second' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Second panel')
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByRole('dialog', { name: 'Details' })).toHaveAttribute('open')
    expect(runtime.onSend).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }))
    await waitFor(() => expect(runtime.onSend).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ action: expect.objectContaining({ name: 'save', context: { name: 'Grace' } }) }) })))
    await act(async () => { runtime.process({ version: 'v1.0', deleteSurface: { surfaceId: 'form' } }, 'fixture') })
    expect(container).toBeEmptyDOMElement()
    runtime.dispose()
  })
  test('plain text markdown cannot inject HTML or active links', () => {
    const { container } = mount([{ id: 'root', component: 'Text', text: '<script>alert(1)</script> [click](javascript:alert(1)) ![x](https://example.com/x.png)' }])
    expect(container.querySelector('script,a,img')).toBeNull()
  })
})
