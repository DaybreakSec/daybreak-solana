const threatModelSchema = {
  type: 'object',
  properties: {
    programSummary: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        framework: { type: 'string' },
        totalLoc: { type: 'integer' },
        instructionCount: { type: 'integer' },
        handlesFunds: { type: 'boolean' },
        usesOracles: { type: 'boolean' },
        complexityProfile: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      required: ['name', 'framework', 'totalLoc', 'instructionCount', 'handlesFunds', 'usesOracles', 'complexityProfile'],
    },
    executiveSummary: { type: 'string' },
    actors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
          instructions: { type: 'array', items: { type: 'string' } },
          trustLevel: { type: 'string', enum: ['untrusted', 'semi-trusted', 'trusted'] },
        },
        required: ['id', 'label', 'description', 'instructions', 'trustLevel'],
      },
    },
    trustBoundaries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          crossedBy: { type: 'array', items: { type: 'string' } },
          riskLevel: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        },
        required: ['name', 'description', 'crossedBy', 'riskLevel'],
      },
    },
    invariants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          property: { type: 'string' },
          type: { type: 'string', enum: ['state', 'access', 'funds'] },
          scope: { type: 'string' },
          importance: { type: 'string', enum: ['critical', 'high', 'medium'] },
        },
        required: ['id', 'property', 'type', 'scope', 'importance'],
      },
    },
    attackSurfaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          instructions: { type: 'array', items: { type: 'string' } },
          threatLevel: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          exposureFactors: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'description', 'instructions', 'threatLevel', 'exposureFactors'],
      },
    },
    threatCategories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['access-control', 'arithmetic-economic', 'cpi-token', 'state-lifecycle', 'invariant-logic'] },
          summary: { type: 'string' },
          relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
          affectedInstructions: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'summary', 'relevance', 'affectedInstructions'],
      },
    },
  },
  required: [
    'programSummary', 'executiveSummary', 'actors', 'trustBoundaries',
    'invariants', 'attackSurfaces', 'threatCategories',
  ],
};

module.exports = threatModelSchema;
