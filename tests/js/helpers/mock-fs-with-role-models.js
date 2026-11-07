// Keep filesystem effects mocked; only the shared launcher's model table is real.
export function mockFsWithRoleModels(actual, vi) {
  const mocked = vi.mockObject(actual);
  const resource = new URL('../../../shared/runtime/role-models.list', import.meta.url);
  const read = vi.fn((file, ...args) => {
    if (file instanceof URL && file.href === resource.href) return actual.readFileSync(file, ...args);
    return undefined;
  });
  mocked.readFileSync = read;
  mocked.default.readFileSync = read;
  return mocked;
}
