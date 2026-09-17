import { fireEvent, render, screen } from '@testing-library/react'
import App from './App'

test('renders the universal workspace', () => {
  render(<App />)
  expect(screen.getByText('Agentic workspace')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Dashboards' }))
  expect(screen.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeInTheDocument()
})
