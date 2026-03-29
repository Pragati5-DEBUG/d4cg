const path = require('path');
const fs = require('fs');
const { ApolloServer } = require('apollo-server-express');
const { gql } = require('apollo-server-express');

const dataPath = path.join(__dirname, 'mockdata', 'adverse_events.json');
let adverseEvents = [];
function loadAdverseEvents() {
  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Expected a JSON array');
    adverseEvents = parsed;
  } catch (err) {
    console.warn('Could not load mock adverse_events.json:', err.message);
    adverseEvents = [];
  }
}

loadAdverseEvents();

try {
  fs.watch(dataPath, (event) => {
    if (event === 'change') loadAdverseEvents();
  });
} catch (err) {
  console.warn('Could not watch mock adverse_events.json:', err.message);
}

const typeDefs = gql`
  type AdverseEvent {
    id: ID!
    projectId: String
    subjectId: String
    timingId: String
    adverseEvent: String
    aeAttribution: String
    aeCode: String
    aeExpected: String
    aeGrade: Int
    aeHospitalization: String
    aeIcu: String
    aeImmune: String
    aeInfusion: String
    aeIntervention: String
    aeInterventionDetail: String
    aeMedication: String
    aeOutcome: String
    aePathogen: String
    aePathogenStatus: String
    aeReported: String
    aeSystem: String
    aeSystemVersion: String
    aeTxMod: String
    ageAtAe: Float
    ageAtAeResolved: Float
    avnJoint: String
    avnJointLaterality: String
    avnMethod: String
    gvhdAcuity: String
    gvhdOrgan: String
    infectionClassification: String
    orthopedicProcedure: String
  }

  type Query {
    adverseEvents: [AdverseEvent!]!
  }
`;

const resolvers = {
  Query: {
    adverseEvents: () => adverseEvents,
  },
};

async function setupGraphQL(app) {
  const server = new ApolloServer({ typeDefs, resolvers });
  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });
  console.log('  GraphQL mock at http://localhost:' + (process.env.PORT || 5002) + '/graphql');
}

module.exports = { setupGraphQL };

