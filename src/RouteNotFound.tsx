import { Link } from "react-router-dom";

export function RouteNotFound() {
  return (
    <>
      <h1>Not found...</h1>
      Go back to the <Link to="/">home page</Link>!
    </>
  );
}
