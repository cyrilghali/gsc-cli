import type { DimensionFilter } from './api.ts'
import { CliError } from './config.ts'

export const FILTER_DIMENSIONS = ['query', 'page', 'country', 'device', 'searchAppearance'] as const

export const FILTER_OPERATORS = ['contains', 'equals', 'notContains', 'notEquals', 'includingRegex', 'excludingRegex'] as const

const DEVICES = ['DESKTOP', 'MOBILE', 'TABLET']

export function parseFilter(input: string): DimensionFilter {
  const match = input.trim().match(/^(\S+)\s+(\S+)\s+([\s\S]+)$/)
  if (!match) {
    throw new CliError(
      `Invalid filter "${input}".`,
      'Expected "<dimension> <operator> <expression>", e.g. --filter "query contains shoes".',
    )
  }
  const [, rawDimension, rawOperator, rawExpression] = match

  const dimension = FILTER_DIMENSIONS.find((d) => d.toLowerCase() === rawDimension.toLowerCase())
  if (!dimension) {
    throw new CliError(`Unknown filter dimension "${rawDimension}".`, `Valid dimensions: ${FILTER_DIMENSIONS.join(', ')}.`)
  }

  const operator = FILTER_OPERATORS.find((o) => o.toLowerCase() === rawOperator.toLowerCase())
  if (!operator) {
    throw new CliError(`Unknown filter operator "${rawOperator}".`, `Valid operators: ${FILTER_OPERATORS.join(', ')}.`)
  }

  let expression = rawExpression.trim()
  if (dimension === 'device') {
    expression = expression.toUpperCase()
    if ((operator === 'equals' || operator === 'notEquals') && !DEVICES.includes(expression)) {
      throw new CliError(`Unknown device "${rawExpression.trim()}".`, `Valid devices: ${DEVICES.join(', ')}.`)
    }
  }
  if (dimension === 'country') {
    // the API uses lowercase ISO 3166-1 alpha-3 codes, e.g. "fra"
    expression = expression.toLowerCase()
  }

  return { dimension, operator, expression }
}
