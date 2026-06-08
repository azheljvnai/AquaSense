/**
 * Vitest stub for firebase-admin (used by dispatch-alert integration tests).
 * Configure handlers via exported mockState before each test.
 */
export const mockState = {
  activeUsersGet: async () => ({ empty: true, docs: [] }),
  prefsGet: async () => ({ exists: false }),
  notificationLogGet: async () => ({ docs: [] }),
  notificationLogAdd: async () => ({ id: 'log-1' }),
  configurationsGet: async () => ({ empty: true, docs: [] }),
  usersCollectionGet: async () => ({ docs: [] }),
  usersDocGet: async () => ({ exists: false, data: () => ({}) }),
  pondsCollectionGet: async () => ({ docs: [] }),
  pondsAdd: async () => ({ id: 'pond-1' }),
  pondsDocDelete: async () => undefined,
  pondsDocSet: async () => undefined,
  configurationsCollectionGet: async () => ({ docs: [] }),
  configurationsAdd: async () => ({ id: 'cfg-1' }),
  configurationsDocGet: async () => ({ exists: false, data: () => ({}) }),
  configurationsDocDelete: async () => undefined,
  configurationsDocSet: async () => undefined,
  configurationsDocUpdate: async () => undefined,
  configurationsQueryGet: async () => ({ docs: [] }),
  // Back-compat for older tests that set mockState.configurationsGet
  configurationsWhereLimitGet: async () => ({ empty: true, docs: [] }),
  pondConfigurationsQueryGet: async () => ({ docs: [] }),
  pondConfigurationsCollectionGet: async () => ({ docs: [] }),
  migrateBackupAdd: async () => ({ id: 'backup-1' }),
  migrateBackupGet: async () => ({ empty: true, docs: [] }),
  authVerifyIdToken: async () => ({ uid: 'test-uid' }),
  authGetUser: async (_uid) => ({ uid: _uid }),
  authCreateUser: async () => ({ uid: 'new-uid' }),
  authUpdateUser: async () => ({}),
  authDeleteUser: async () => ({}),
  usersDocSet: async () => ({}),
  notificationPrefsSet: async () => ({}),
  systemLogsStore: [],
  systemLogsAdd: async (data) => {
    const id = `log-${mockState.systemLogsStore.length + 1}`;
    mockState.systemLogsStore.push({ id, data: { ...data, createdAt: { toMillis: () => Date.now() } } });
    return { id };
  },
  systemLogsQueryGet: async () => ({ docs: [], empty: true, size: 0 }),
  systemLogsDocGet: async (id) => {
    const found = mockState.systemLogsStore.find((x) => x.id === id);
    return found ? { exists: true, id: found.id, data: () => found.data } : { exists: false };
  },
  systemLogsBatchCommit: async () => ({}),
};

const FieldValue = { serverTimestamp: () => ({ _serverTimestamp: true }) };

function firestore() {
  return {
    collection: (name) => {
      if (name === 'users') {
        return {
          get: () => mockState.usersCollectionGet(),
          where: () => ({
            get: () => mockState.activeUsersGet(),
          }),
          doc: (id) => ({
            get: () => mockState.usersDocGet(id),
            set: (data, opts) => mockState.usersDocSet?.(id, data, opts),
            delete: () => mockState.usersDocDelete?.(id),
            collection: (subName) => {
              if (subName === 'notificationPrefs') {
                return {
                  doc: (docId) => ({
                    set: (data, opts) => mockState.notificationPrefsSet?.(id, docId, data, opts),
                  }),
                };
              }
              return { doc: () => ({ set: async () => ({}) }) };
            },
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
      if (name === 'configurations') {
        return {
          get: () => mockState.configurationsCollectionGet(),
          where: () => ({
            limit: () => ({
              get: () =>
                mockState.configurationsGet
                  ? mockState.configurationsGet()
                  : mockState.configurationsWhereLimitGet(),
            }),
            get: () => mockState.configurationsQueryGet(),
          }),
          add: (data) => mockState.configurationsAdd(data),
          doc: (id) => ({
            get: () => mockState.configurationsDocGet(id),
            set: (data, opts) => mockState.configurationsDocSet(id, data, opts),
            delete: () => mockState.configurationsDocDelete(id),
            update: (data) => mockState.configurationsDocUpdate(id, data),
          }),
        };
      }
      if (name === 'ponds') {
        return {
          get: () => mockState.pondsCollectionGet(),
          add: (data) => mockState.pondsAdd(data),
          doc: (id) => ({
            set: (data, opts) => mockState.pondsDocSet(id, data, opts),
            delete: () => mockState.pondsDocDelete(id),
            get: () => mockState.pondsDocGet?.(id),
          }),
        };
      }
      if (name === 'pond_configurations') {
        return {
          get: () => mockState.pondConfigurationsCollectionGet(),
          where: () => ({
            get: () => mockState.pondConfigurationsQueryGet(),
          }),
          add: (data) => mockState.pondConfigurationsAdd?.(data) || Promise.resolve({ id: 'pondcfg-1' }),
          doc: (id) => ({
            get: () => mockState.pondConfigurationsDocGet?.(id) || Promise.resolve({ exists: false, data: () => ({}) }),
            set: (data, opts) => mockState.pondConfigurationsDocSet?.(id, data, opts),
            delete: () => mockState.pondConfigurationsDocDelete?.(id),
            update: (data) => mockState.pondConfigurationsDocUpdate?.(id, data),
          }),
        };
      }
      if (name === 'migrations_backup') {
        return {
          add: (data) => mockState.migrateBackupAdd(data),
          orderBy: () => ({
            limit: () => ({
              get: () => mockState.migrateBackupGet(),
            }),
            get: () => mockState.migrateBackupGet(),
          }),
        };
      }
      if (name === 'system_logs') {
        const chainState = { filters: [], orderDir: null, limitN: null, startAfterId: null };
        const runQuery = () => {
          let rows = [...mockState.systemLogsStore];
          for (const f of chainState.filters) {
            if (f.op === '==') rows = rows.filter((r) => r.data[f.field] === f.value);
            if (f.op === '>=') {
              const ms = f.value?.toMillis?.() ?? f.value;
              rows = rows.filter((r) => (r.data.createdAt?.toMillis?.() ?? 0) >= ms);
            }
            if (f.op === '<=') {
              const ms = f.value?.toMillis?.() ?? f.value;
              rows = rows.filter((r) => (r.data.createdAt?.toMillis?.() ?? 0) <= ms);
            }
          }
          if (chainState.orderDir === 'desc') {
            rows.sort((a, b) => (b.data.createdAt?.toMillis?.() ?? 0) - (a.data.createdAt?.toMillis?.() ?? 0));
          }
          if (chainState.startAfterId) {
            const idx = rows.findIndex((r) => r.id === chainState.startAfterId);
            if (idx >= 0) rows = rows.slice(idx + 1);
          }
          const limitN = chainState.limitN ?? rows.length;
          rows = rows.slice(0, limitN);
          const docs = rows.map((r) => ({
            id: r.id,
            data: () => r.data,
            ref: { delete: () => { mockState.systemLogsStore = mockState.systemLogsStore.filter((x) => x.id !== r.id); } },
          }));
          return { docs, empty: docs.length === 0, size: docs.length };
        };
        const chain = {
          where(field, op, value) {
            chainState.filters.push({ field, op, value });
            return chain;
          },
          orderBy(_field, dir) {
            chainState.orderDir = dir;
            return chain;
          },
          limit(n) {
            chainState.limitN = n;
            return chain;
          },
          startAfter(doc) {
            chainState.startAfterId = doc?.id ?? doc;
            return chain;
          },
          count() {
            return {
              get: () => {
                const savedLimit = chainState.limitN;
                chainState.limitN = null;
                const result = runQuery();
                chainState.limitN = savedLimit;
                const count = result.docs.length;
                return Promise.resolve({ data: () => ({ count }) });
              },
            };
          },
          get: () => mockState.systemLogsQueryGet?.() ?? runQuery(),
        };
        chain.get = () => Promise.resolve(runQuery());
        return {
          add: (data) => mockState.systemLogsAdd(data),
          doc: (id) => ({
            get: () => mockState.systemLogsDocGet(id),
            delete: () => {
              mockState.systemLogsStore = mockState.systemLogsStore.filter((x) => x.id !== id);
              return Promise.resolve();
            },
          }),
          where: (field, op, value) => chain.where(field, op, value),
          orderBy: (field, dir) => chain.orderBy(field, dir),
          limit: (n) => chain.limit(n),
        };
      }
      return {};
    },
    doc: (path) => ({
      get: () => (path.includes('notificationPrefs') ? mockState.prefsGet() : Promise.resolve({ exists: false })),
    }),
    batch: () => {
      const ops = [];
      return {
        set: (ref, data) => ops.push({ op: 'set', ref, data }),
        update: (ref, data) => ops.push({ op: 'update', ref, data }),
        delete: (ref) => ops.push({ op: 'delete', ref }),
        commit: async () => {
          for (const op of ops) {
            if (op.op === 'delete' && op.ref?.delete) await op.ref.delete();
          }
          return mockState.systemLogsBatchCommit?.() ?? { ops };
        },
      };
    },
  };
}
firestore.FieldValue = FieldValue;

function auth() {
  return {
    verifyIdToken: (token) => mockState.authVerifyIdToken(token),
    getUser: (uid) => mockState.authGetUser(uid),
    createUser: (data) => mockState.authCreateUser(data),
    updateUser: (uid, data) => mockState.authUpdateUser(uid, data),
    deleteUser: (uid) => mockState.authDeleteUser(uid),
  };
}

const admin = {
  apps: [{ name: 'vitest' }],
  firestore,
  auth,
};

export default admin;
