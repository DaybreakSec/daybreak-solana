const scoutSchema = {
  type: 'object',
  properties: {
    instructions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          accounts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                isSigner: { type: 'boolean' },
                isMut: { type: 'boolean' },
              },
              required: ['name', 'isSigner', 'isMut'],
            },
          },
          actors: { type: 'array', items: { type: 'string' } },
          handlesFunds: { type: 'boolean' },
          complexityRating: { type: 'string', enum: ['high', 'medium', 'low'] },
          complexityRationale: { type: 'string' },
        },
        required: ['name', 'file', 'line', 'accounts', 'actors', 'handlesFunds', 'complexityRating'],
      },
    },
    invariants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          type: { type: 'string', enum: ['state', 'access', 'funds'] },
          relatedInstructions: { type: 'array', items: { type: 'string' } },
        },
        required: ['description', 'type', 'relatedInstructions'],
      },
    },
    crossFlows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          fromInstruction: { type: 'string' },
          toInstruction: { type: 'string' },
        },
        required: ['description', 'fromInstruction', 'toInstruction'],
      },
    },
    sharedState: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          modifiedBy: { type: 'array', items: { type: 'string' } },
          readBy: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'modifiedBy', 'readBy'],
      },
    },
  },
  required: ['instructions', 'invariants', 'crossFlows', 'sharedState'],
};

module.exports = scoutSchema;
