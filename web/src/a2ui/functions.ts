import { testRegex } from './regex'
import { format, parseISO } from 'date-fns'
import { ExpressionParser } from './expression-parser'
import { record, type JsonMap } from './schema'

export type FunctionContext = { resolve: (value: unknown) => unknown; activation: boolean; locale?: string }
export type LocalFunction = (args: JsonMap, context: FunctionContext) => unknown
const valid = (valid: boolean, message: string) => ({ valid, ...(valid ? {} : { message, severity: 'error' }) })
const truth = (value: unknown) => record(value) && typeof value.valid === 'boolean' ? value.valid : value === true
export const stringify = (value: unknown) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
export const parser = new ExpressionParser()
export const basicFunctions: Record<string, LocalFunction> = {
  required: ({ value }) => valid(value != null && value !== '' && (!Array.isArray(value) || value.length > 0), 'A value is required.'),
  regex: ({ value, pattern }) => testRegex(String(pattern), String(value ?? '')),
  length: ({ value, min, max }) => valid(typeof value === 'string' && (min === undefined || value.length >= min) && (max === undefined || value.length <= max), 'Length is outside the allowed range.'),
  numeric: ({ value, min, max }) => valid(typeof value === 'number' && Number.isFinite(value) && (min === undefined || value >= min) && (max === undefined || value <= max), 'Number is outside the allowed range.'),
  email: ({ value }) => valid(typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Enter a valid email address.'),
  formatNumber: ({ value, grouping, decimals }, { locale }) => new Intl.NumberFormat(locale, { useGrouping: grouping !== false, ...(decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) }).format(value),
  formatCurrency: ({ value, currency, grouping, decimals }, { locale }) => new Intl.NumberFormat(locale, { style: 'currency', currency, useGrouping: grouping !== false, ...(decimals === undefined ? {} : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) }).format(value),
  formatDate: ({ value, format: pattern }) => format(parseISO(value), pattern),
  pluralize: (args, { locale }) => args[new Intl.PluralRules(locale).select(args.value)] ?? args.other,
  openUrl: ({ url }, { activation }) => {
    if (!activation || (navigator.userActivation && !navigator.userActivation.isActive)) throw new Error('openUrl requires active user interaction.')
    const parsed = new URL(String(url), window.location.href)
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Only HTTP(S) navigation is permitted.')
    window.open(parsed.href, '_blank', 'noopener,noreferrer')
    return null
  },
  and: ({ values }) => values.every(truth),
  or: ({ values }) => values.some(truth),
  not: ({ value }) => !truth(value),
}
