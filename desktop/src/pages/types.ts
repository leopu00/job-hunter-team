/** What the shell hands every page: the route's `:params` and the query string. */
export type PageProps = {
  params: Record<string, string>;
  search: URLSearchParams;
};
