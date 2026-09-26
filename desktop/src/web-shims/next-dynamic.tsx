import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

/**
 * Stand-in for `next/dynamic`: React.lazy plus the optional `loading`
 * placeholder. `ssr` means nothing in the webview and is ignored.
 */
type Loaded<P> = ComponentType<P> | { default: ComponentType<P> };

export default function dynamic<P extends object>(
  loader: () => Promise<Loaded<P>>,
  options: { loading?: () => ReactNode; ssr?: boolean } = {},
): ComponentType<P> {
  const Lazy = lazy(async () => {
    const mod = await loader();
    return { default: "default" in mod ? mod.default : mod };
  });
  const fallback = options.loading ? options.loading() : null;
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
