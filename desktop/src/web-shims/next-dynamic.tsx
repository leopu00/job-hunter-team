import { lazy, Suspense, type ComponentProps, type ComponentType, type ReactNode } from "react";

/**
 * Stand-in for `next/dynamic`: React.lazy plus the optional `loading`
 * placeholder. `ssr` means nothing in the webview and is ignored.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function dynamic<C extends ComponentType<any>>(
  loader: () => Promise<C | { default: C }>,
  options: { loading?: () => ReactNode; ssr?: boolean } = {},
): C {
  const Lazy = lazy(async () => {
    const mod = await loader();
    return { default: "default" in mod ? mod.default : mod };
  });
  const fallback = options.loading ? options.loading() : null;
  function Dynamic(props: ComponentProps<C>) {
    return (
      <Suspense fallback={fallback}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return Dynamic as unknown as C;
}
