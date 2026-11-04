const formatted =
  /^(apps\/|package\.json$|\.oxfmtrc\.json$|commitlint\.config\.js$|lint-staged\.config\.js$)/
const lintable = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const testable = /\.(ts|tsx)$/

const relative = (file) => file.slice(process.cwd().length + 1)
const quote = (file) => JSON.stringify(file)

// Lints and typechecks an app with staged code, and runs the unit tests that import it.
const checkApp = (app, files) => {
  const staged = files.filter((file) => file.startsWith(`apps/${app}/`))
  const tests = staged
    .filter((file) => testable.test(file))
    .map((file) => `${process.cwd()}/${file}`)

  if (!staged.some((file) => lintable.test(file))) return []

  return [
    `npm run lint --prefix apps/${app}`,
    `npm run typecheck --prefix apps/${app}`,
    ...(tests.length > 0
      ? [`npm run test:related --prefix apps/${app} -- ${tests.map(quote).join(' ')}`]
      : []),
  ]
}

export default {
  '*': (absoluteFiles) => {
    const files = absoluteFiles.map(relative)
    const toFormat = files.filter((file) => formatted.test(file))

    return [
      ...(toFormat.length > 0
        ? [`oxfmt --write --no-error-on-unmatched-pattern ${toFormat.map(quote).join(' ')}`]
        : []),
      ...checkApp('server', files),
      ...checkApp('web', files),
    ]
  },
}
