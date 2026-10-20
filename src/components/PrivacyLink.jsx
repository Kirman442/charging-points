export default function PrivacyLink({ className }) {
  return <span className={className}><a href={`${import.meta.env.BASE_URL}datenschutz.html#datenschutz`} lang="de">Datenschutz</a><span aria-hidden="true"> · </span><a href={`${import.meta.env.BASE_URL}impressum.html`} lang="de">Impressum</a></span>
}
