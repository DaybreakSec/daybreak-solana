const findingSchema = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'informational'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          bugClass: { type: 'string' },
          description: { type: 'string' },
          proof: { type: 'string' },
          recommendation: { type: 'string' },
          dedupKey: { type: 'string' },
          detection: { type: 'string' },
          highlightLines: { type: 'array', items: { type: 'integer' } },
          leadDisposition: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                leadId: { type: 'string' },
                status: { type: 'string', enum: ['confirmed', 'dismissed'] },
                reason: { type: 'string' },
              },
              required: ['leadId', 'status', 'reason'],
            },
          },
        },
        required: ['title', 'severity', 'confidence', 'file', 'line', 'bugClass', 'description', 'proof', 'recommendation', 'dedupKey'],
      },
    },
  },
  required: ['findings'],
};

module.exports = findingSchema;
