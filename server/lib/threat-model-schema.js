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
    attackSurfaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          instructions: { type: 'array', items: { type: 'string' } },
          threatLevel: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          attackVectors: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'description', 'instructions', 'threatLevel', 'attackVectors'],
      },
    },
    threatCategories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['access-control', 'arithmetic-economic', 'cpi-token', 'state-lifecycle', 'invariant-logic'] },
          threats: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                likelihood: { type: 'string', enum: ['high', 'medium', 'low'] },
                impact: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                affectedInstructions: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'title', 'description', 'likelihood', 'impact', 'affectedInstructions'],
            },
          },
        },
        required: ['category', 'threats'],
      },
    },
    invariantThreats: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          invariant: { type: 'string' },
          type: { type: 'string', enum: ['state', 'access', 'funds'] },
          threatenedBy: { type: 'array', items: { type: 'string' } },
          potentialViolations: { type: 'array', items: { type: 'string' } },
        },
        required: ['invariant', 'type', 'threatenedBy', 'potentialViolations'],
      },
    },
    executiveSummary: { type: 'string' },
    keyRisks: { type: 'array', items: { type: 'string' } },
    recommendedFocus: { type: 'array', items: { type: 'string' } },
    attackNarratives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          narrative: { type: 'string' },
          preconditions: { type: 'array', items: { type: 'string' } },
          estimatedSeverity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        },
        required: ['title', 'narrative', 'preconditions', 'estimatedSeverity'],
      },
    },
  },
  required: [
    'programSummary', 'actors', 'trustBoundaries', 'attackSurfaces',
    'threatCategories', 'invariantThreats', 'executiveSummary',
    'keyRisks', 'recommendedFocus', 'attackNarratives',
  ],
};

module.exports = threatModelSchema;
