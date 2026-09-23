import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Bell, BellOff, Calendar, CalendarDays, Camera, Check, CircleAlert, CircleHelp, CircleUserRound, CreditCard, Download, Ellipsis, EllipsisVertical, Eye, EyeOff, FastForward, Folder, Heart, HeartOff, House, Image, Info, Lock, LockOpen, Mail, MapPin, Menu, Paperclip, Pause, Pencil, Phone, PhoneCall, Play, Plus, Printer, RefreshCw, Rewind, Search, Send, Settings, Share2, ShoppingCart, SkipBack, SkipForward, Square, Star, StarHalf, StarOff, Trash2, TriangleAlert, Upload, User, Volume, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { A2UIRuntime, PENDING, type RuntimeContext, type Scope } from './runtime'
import { absolutePath } from './data'
import { BASIC_CATALOG_ID, record, type JsonMap } from './schema'
import { stringify } from './functions'
import { safeUrl } from '../protocol'
import './a2ui.css'

export const A2UIContext = createContext<A2UIRuntime | null>(null)
export type CustomComponentProps = { props: JsonMap; raw: JsonMap; children: ReactNode; runtime: A2UIRuntime; context: RuntimeContext; renderChild: (id: string) => ReactNode; setValue: (property: string, value: unknown) => void }
const customComponents = new Map<string, ComponentType<CustomComponentProps>>()
export function registerA2UIComponent(catalogId: string, name: string, component: ComponentType<CustomComponentProps>) { customComponents.set(catalogId + '#' + name, component) }
const iconNames: Record<string, ComponentType<{ size: number; 'aria-hidden': boolean }>> = {
  accountCircle: CircleUserRound, add: Plus, arrowBack: ArrowLeft, arrowForward: ArrowRight, attachFile: Paperclip, calendarToday: CalendarDays, call: PhoneCall, camera: Camera, check: Check, close: X, delete: Trash2, download: Download, edit: Pencil, event: Calendar, error: CircleAlert, fastForward: FastForward, favorite: Heart, favoriteOff: HeartOff, folder: Folder, help: CircleHelp, home: House, info: Info, locationOn: MapPin, lock: Lock, lockOpen: LockOpen, mail: Mail, menu: Menu, moreVert: EllipsisVertical, moreHoriz: Ellipsis, notificationsOff: BellOff, notifications: Bell, pause: Pause, payment: CreditCard, person: User, phone: Phone, photo: Image, play: Play, print: Printer, refresh: RefreshCw, rewind: Rewind, search: Search, send: Send, settings: Settings, share: Share2, shoppingCart: ShoppingCart, skipNext: SkipForward, skipPrevious: SkipBack, star: Star, starHalf: StarHalf, starOff: StarOff, stop: Square, upload: Upload, visibility: Eye, visibilityOff: EyeOff, volumeDown: Volume1, volumeMute: Volume, volumeOff: VolumeX, volumeUp: Volume2, warning: TriangleAlert,
}
function Icon({ name }: { name: unknown }) {
  if (record(name) && typeof name.svgPath === 'string') return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d={name.svgPath} /></svg>
  const Component = iconNames[String(name)]
  return Component ? <Component size={24} aria-hidden /> : <span>Unknown icon: {stringify(name)}</span>
}
function Modal({ trigger, content, label }: { trigger: ReactNode; content: ReactNode; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  return <><div onClickCapture={(event) => { event.preventDefault(); event.stopPropagation(); dialog.current?.showModal() }} onKeyDownCapture={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); dialog.current?.showModal() } }}>{trigger}</div><dialog ref={dialog} aria-label={label || 'Dialog'} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close() }}><button type="button" className="a2v1-close" aria-label="Close dialog" onClick={() => dialog.current?.close()}>×</button>{content}</dialog></>
}
function DateInput({ props: p, update, attrs }: { props: JsonMap; update: (value: string) => void; attrs: JsonMap }) {
  const type = p.enableDate && p.enableTime ? 'datetime-local' : p.enableTime ? 'time' : p.enableDate ? 'date' : 'text'
  const normalize = (value: unknown) => {
    const text = stringify(value)
    if (type === 'datetime-local' && text) {
      const d = new Date(text)
      if (Number.isFinite(d.getTime())) return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    }
    return type === 'date' ? text.slice(0, 10) : type === 'time' ? text.includes('T') ? text.split('T')[1].slice(0, 8) : text.replace(/Z$/, '') : text
  }
  return <label>{stringify(p.label)}<input {...attrs} type={type} value={normalize(p.value)} min={normalize(p.min) || undefined} max={normalize(p.max) || undefined} onChange={(event) => { const value = event.target.value; update(value && type === 'datetime-local' ? new Date(value).toISOString() : value) }} /></label>
}
type NodeProps = { runtime: A2UIRuntime; surfaceId: string; id: string; scope: Scope; ancestors: string[] }
function Node({ runtime, surfaceId, id, scope, ancestors }: NodeProps) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot)
  const [activeTab, setActiveTab] = useState(0)
  const [filter, setFilter] = useState('')
  const uid = useId()
  const surface = runtime.surfaces.get(surfaceId)
  const node = surface?.components.get(id)
  let failure = ''
  const p: JsonMap = {}
  let pending = false
  const context: RuntimeContext = { ...scope, surfaceId, owner: surface?.owner || '', catalogId: surface?.catalogId }
  if (node) for (const [key, value] of Object.entries(node)) {
    if (['children', 'child', 'trigger', 'content', 'action', 'checks', 'metadata', 'catalogId'].includes(key)) { p[key] = value; continue }
    try { const resolved = runtime.resolve(value, context); if (resolved === PENDING) { pending = true; p[key] = undefined } else p[key] = resolved }
    catch (error) { failure = (error as Error).message; p[key] = null }
  }
  useEffect(() => { if (failure && surface) runtime.report(new Error(failure), surface.owner, surfaceId) }, [runtime, failure, surface, surfaceId])
  if (!surface || !node) return <span className="a2v1-placeholder" data-component-id={id}>Waiting for {id}…</span>
  if (ancestors.includes(id) || ancestors.length > 64) return <span role="alert">Invalid component cycle.</span>
  const checks = runtime.checks(node, context)
  const child = (childId: string, childScope = scope) => <Node key={childId + childScope.path} runtime={runtime} surfaceId={surfaceId} id={childId} scope={childScope} ancestors={[...ancestors, id]} />
  let children: ReactNode = null
  if (Array.isArray(node.children)) children = node.children.map((childId: string) => child(childId))
  else if (record(node.children)) {
    const path = absolutePath(node.children.path, scope.path)
    let values: unknown
    try { values = runtime.resolve({ path }, context) } catch { values = [] }
    if (Array.isArray(values)) children = values.slice(0, 2000).map((_, index) => child(node.children.componentId, { path: path.replace(/\/$/, '') + '/' + index, index }))
  }
  const setValue = (property: string, value: unknown) => runtime.updateInput(surfaceId, node[property], value, scope)
  const accessibility = record(p.accessibility) ? p.accessibility : {}
  const attrs = {
    'aria-label': accessibility.label == null ? undefined : stringify(accessibility.label),
    'aria-describedby': accessibility.description ? uid + '-description' : undefined,
    'aria-live': accessibility.live,
    'aria-hidden': accessibility.hidden,
    'aria-busy': pending || checks.pending || undefined,
    'aria-invalid': checks.messages.length > 0 || undefined,
  }
  const align: Record<string, string> = { start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch', spaceBetween: 'space-between', spaceAround: 'space-around', spaceEvenly: 'space-evenly', baseline: 'baseline' }
  const layout: CSSProperties = { display: 'flex', flexDirection: node.component === 'Row' || p.direction === 'horizontal' ? 'row' : 'column', justifyContent: align[p.justify], alignItems: align[p.align] }
  let body: ReactNode
  const custom = customComponents.get((node.catalogId ?? surface.catalogId) + '#' + node.component)
  if ((node.catalogId ?? surface.catalogId) !== BASIC_CATALOG_ID) {
    const Custom = custom
    // Registry entries are stable, trusted application components.
    // eslint-disable-next-line react-hooks/static-components
    body = Custom ? <Custom props={p} raw={node} children={children} runtime={runtime} context={context} renderChild={child} setValue={setValue} /> : <div role="alert">No implementation registered for {node.component}.</div>
  } else switch (node.component) {
    case 'Text': body = <div {...attrs} className={'a2v1-text ' + (p.variant || 'body')}><ReactMarkdown skipHtml disallowedElements={['a', 'img']} unwrapDisallowed>{stringify(p.text)}</ReactMarkdown></div>; break
    case 'Image': body = <img {...attrs} className={'a2v1-image ' + (p.variant || 'mediumFeature')} src={safeUrl(p.url)} alt={stringify(accessibility.label ?? p.description)} style={{ objectFit: p.fit === 'scaleDown' ? 'scale-down' : p.fit }} />; break
    case 'Icon': body = <span {...attrs} role={attrs['aria-label'] ? 'img' : undefined}><Icon name={p.name} /></span>; break
    case 'Video': body = <video {...attrs} controls src={safeUrl(p.url)} poster={safeUrl(p.posterUrl)} />; break
    case 'AudioPlayer': body = <figure {...attrs}><audio controls src={safeUrl(p.url)} /><figcaption>{stringify(p.description)}</figcaption></figure>; break
    case 'Row': case 'Column': case 'List': body = <div {...attrs} className={node.component === 'List' ? 'a2v1-list' : ''} style={layout}>{children}</div>; break
    case 'Card': body = <section {...attrs} className="a2v1-card">{child(node.child)}</section>; break
    case 'Tabs': {
      const tabs = Array.isArray(p.tabs) ? p.tabs : []
      const selected = Math.min(activeTab, tabs.length - 1)
      body = <div {...attrs}><div role="tablist">{tabs.map((tab: JsonMap, index: number) => <button role="tab" type="button" id={uid + '-tab-' + index} aria-controls={uid + '-panel'} aria-selected={index === selected} tabIndex={index === selected ? 0 : -1} key={index} onClick={() => setActiveTab(index)} onKeyDown={(event) => { const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null; if (next !== null) { event.preventDefault(); setActiveTab(next); document.getElementById(uid + '-tab-' + next)?.focus() } }}>{stringify(tab.title)}</button>)}</div>{tabs[selected] && <div role="tabpanel" id={uid + '-panel'} aria-labelledby={uid + '-tab-' + selected}>{child(tabs[selected].child)}</div>}</div>; break
    }
    case 'Divider': body = <div {...attrs} role="separator" aria-orientation={p.axis || 'horizontal'} className={'a2v1-divider ' + (p.axis || 'horizontal')} />; break
    case 'Modal': body = <Modal trigger={child(node.trigger)} content={child(node.content)} label={stringify(accessibility.label)} />; break
    case 'Button': body = <button {...attrs} type="button" disabled={!checks.valid || pending} className={'a2v1-button ' + (p.variant || 'default')} onClick={(event) => void runtime.action(surfaceId, id, scope, event.nativeEvent.isTrusted)}>{child(node.child)}</button>; break
    case 'TextField': body = <label>{stringify(p.label)}{p.variant === 'longText' ? <textarea {...attrs} value={stringify(p.value)} placeholder={stringify(p.placeholder)} onChange={(event) => setValue('value', event.target.value)} /> : <input {...attrs} type={p.variant === 'obscured' ? 'password' : p.variant === 'number' ? 'number' : 'text'} value={stringify(p.value)} placeholder={stringify(p.placeholder)} onChange={(event) => setValue('value', event.target.value)} />}</label>; break
    case 'CheckBox': body = <label><input {...attrs} type="checkbox" checked={p.value === true} onChange={(event) => setValue('value', event.target.checked)} />{stringify(p.label)}</label>; break
    case 'ChoicePicker': {
      const selected: string[] = Array.isArray(p.value) ? p.value : []
      const options = (Array.isArray(p.options) ? p.options : []).filter((option: JsonMap) => stringify(option.label).toLowerCase().includes(filter.toLowerCase()))
      const toggle = (value: string) => setValue('value', p.variant === 'multipleSelection' ? selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value] : [value])
      body = <fieldset {...attrs} className={'a2v1-choice ' + p.displayStyle}><legend>{stringify(p.label)}</legend>{p.filterable && <input aria-label="Filter choices" value={filter} onChange={(event) => setFilter(event.target.value)} />}{options.map((option: JsonMap) => p.displayStyle === 'chips' ? <button type="button" key={option.value} aria-pressed={selected.includes(option.value)} onClick={() => toggle(option.value)}>{stringify(option.label)}</button> : <label key={option.value}><input type={p.variant === 'multipleSelection' ? 'checkbox' : 'radio'} name={uid} checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />{stringify(option.label)}</label>)}</fieldset>; break
    }
    case 'Slider': body = <label>{stringify(p.label)}<input {...attrs} type="range" min={p.min ?? 0} max={p.max} step={p.steps ? (p.max - (p.min ?? 0)) / p.steps : 'any'} value={typeof p.value === 'number' ? p.value : p.min ?? 0} onChange={(event) => setValue('value', Number(event.target.value))} /><output>{stringify(p.value)}</output></label>; break
    case 'DateTimeInput': body = <DateInput props={p} attrs={attrs} update={(value) => setValue('value', value)} />; break
    default: body = <div role="alert">Unsupported component: {node.component}</div>
  }
  return <div className={'a2v1-node a2v1-' + node.component} data-component-id={id} style={typeof node.weight === 'number' ? { flexGrow: node.weight, flexBasis: 0 } : undefined}>{body}{accessibility.description && <span className="a2v1-sr" id={uid + '-description'}>{stringify(accessibility.description)}</span>}{checks.messages.map((message, index) => <p className="a2v1-error" role="alert" key={index}>{message}</p>)}{failure && <p role="alert">{failure}</p>}</div>
}

export function V1Surface({ surfaceId }: { surfaceId: string }) {
  const runtime = useContext(A2UIContext)
  if (!runtime) return <p role="alert">A2UI runtime is not connected.</p>
  return <SurfaceView runtime={runtime} surfaceId={surfaceId} />
}
function SurfaceView({ runtime, surfaceId }: { runtime: A2UIRuntime; surfaceId: string }) {
  useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot)
  const surface = runtime.surfaces.get(surfaceId)
  if (!surface) return null
  return <div className="a2v1-surface" data-surface-id={surfaceId}><Node runtime={runtime} surfaceId={surfaceId} id="root" scope={{ path: '' }} ancestors={[]} /></div>
}
