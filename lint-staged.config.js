const formatted =
  /^(apps\/|package\.json$|\.oxfmtrc\.json$|commitlint\.config\.js$|lint-staged\.config\.js$)/
const lintable = /\.(ts|tsx|js|jsx|mjs|cjs)$/

const relative = (file) => file.slice(process.cwd().length + 1)
const quote = (file) => JSON.stringify(file)

const lintApp = (app, files) =>
  files.some((file) => file.startsWith(`apps/${app}/`) && lintable.test(file))
    ? [`npm run lint --prefix apps/${app}`]
    : []

export default {
  '*': (absoluteFiles) => {
    const files = absoluteFiles.map(relative)
    const toFormat = files.filter((file) => formatted.test(file))

    return [
      ...(toFormat.length > 0
        ? [`oxfmt --write --no-error-on-unmatched-pattern ${toFormat.map(quote).join(' ')}`]
        : []),
      ...lintApp('server', files),
      ...lintApp('web', files),
    ]
  },
}
