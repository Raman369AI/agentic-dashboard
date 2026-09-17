import { render, screen } from '@testing-library/react'
import App from './App'

test('renders the universal workspace', () => {
  render(<App />)
  expect(screen.getByText('Agentic workspace')).toBeInTheDocument()
  expect(screen.getByText('Workspace overview')).toBeInTheDocument()
})
