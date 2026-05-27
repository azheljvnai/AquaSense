/**
 * Vitest stub for firebase-admin (used by dispatch-alert integration tests).
 * Configure handlers via exported mockState before each test.
 */
export const mockState = {
  activeUsersGet: async () => ({ empty: true, docs: [] }),
  prefsGet: async () => ({ exists: false }),
  notificationLogGet: async () => ({ docs: [] }),
  notificationLogAdd: async () => ({ id: 'log-1' }),
};

const FieldValue = { serverTimestamp: () => ({ _serverTimestamp: true }) };

function firestore() {
  return {
    collection: (name) => {
      if (name === 'users') {
        return {
          where: () => ({
            get: () => mockState.activeUsersGet(),
          }),
        };
      }
      if (name === 'notificationLog') {
        return {
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                get: () => mockState.notificationLogGet(),
              }),
            }),
          }),
          add: (data) => mockState.notificationLogAdd(data),
        };
      }
      return {};
    },
    doc: (path) => ({
      get: () => (path.includes('notificationPrefs') ? mockState.prefsGet() : Promise.resolve({ exists: false })),
    }),
  };
}
firestore.FieldValue = FieldValue;

const admin = {
  apps: [{ name: 'vitest' }],
  firestore,
};

export default admin;
