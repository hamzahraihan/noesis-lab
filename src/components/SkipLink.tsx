/**
 * The skip link every framed page carries.
 *
 * A bare `href="#main"` does not work here: the app routes on the hash, so
 * the browser hands the click to the router and the visitor lands on `/`
 * rather than on the content. The jump is done here instead and the router
 * never sees it -- which is why every page's `<main>` carries
 * `tabIndex={-1}`, so it can take the focus programmatically.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="skip-link"
      onClick={(event) => {
        const main = document.getElementById('main');
        if (!main) return;
        event.preventDefault();
        main.focus();
      }}
    >
      Skip to content
    </a>
  );
}
