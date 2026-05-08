const validationSchema = {
  type: 'object',
  properties: {
    validations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          findingId: { type: 'string' },
          verdict: {
            type: 'string',
            enum: ['confirmed', 'refuted', 'uncertain', 'severity-adjusted', 'duplicate'],
          },
          adjustedSeverity: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low', 'informational'],
          },
          duplicateOf: { type: 'string' },
          reasoning: { type: 'string' },
          codeEvidence: { type: 'string' },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
          },
          attackerModel: {
            type: 'object',
            properties: {
              who: { type: 'string' },
              gains: { type: 'string' },
              risks: { type: 'string' },
            },
            required: ['who', 'gains', 'risks'],
          },
          feasibilityPredicate: { type: 'string' },
          conceptualPoc: { type: 'string' },
          backpressurePattern: { type: 'string' },
          calibration: { type: 'string' },
          evidenceRequest: { type: 'string' },
        },
        required: ['findingId', 'verdict', 'reasoning', 'confidence', 'attackerModel', 'feasibilityPredicate'],
      },
    },
  },
  required: ['validations'],
};

module.exports = validationSchema;
