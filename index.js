#! /usr/bin/env node

const _ = require('lodash')
const os = require('os')
const path = require('path')
const commander = require('commander')
const fs = require('fs')
const childProcess = require('child_process')
const inquirer = require('inquirer')
const npmSafeName = require('npm-safe-name')
const jsonfile = require('jsonfile')
const colors = require('colors/safe')
const https = require('https')
const request = require('request')
const tarPack = require('tar-pack')
const fstream = require('fstream')
const fstreamNpm = require('fstream-npm')
const rimraf = require('rimraf')

const userCommandsDir = path.join(os.homedir(), 'Library/Application Support/Lacona/Addons')

const pkg = fs.existsSync('./package.json') ? jsonfile.readFileSync('./package.json') : {}
const pkgLacona = pkg.lacona || {}

function getDefaultDotIgnore (...additional) {
  return `# Logs
logs
*.log
npm-debug.log*

# Runtime data
pids
*.pid
*.seed

# Directory for instrumented libs generated by jscoverage/JSCover
lib-cov

# Coverage directory used by tools like istanbul
coverage

# nyc test coverage
.nyc_output

# Grunt intermediate storage (http://gruntjs.com/creating-plugins#storing-task-files)
.grunt

# node-waf configuration
.lock-wscript

# Compiled binary addons (http://nodejs.org/api/addons.html)
build/Release

# Dependency directories
node_modules
jspm_packages

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Additional Lacona ignores
${additional.join('\n')}
`
  }

function generateExtensionsSourceTranspile (results) {
  if (results.type === 'command') {
    return `/** @jsx createElement */
import { createElement } from 'elliptical'
import { Command } from 'lacona-phrases'
import { runApplescript } from 'lacona-api'

export const MyNewCommand = {
  extends: [Command],

  execute (result) {
    console.log('executing MyNewCommand')
    runApplescript(\`display alert $\{result\}!\`)
  },

  describe (${results.config ? '{config}' : ''}) {
    return (
      <literal
        text='test my new command'
        value=${results.config
          ? `{config.${configify(results.name)}.message}`
          : "'Hello, world!'"} />
    )
  }
}

export default [MyNewCommand]
`
  } else { //extension
    return `/** @jsx createElement */
import { createElement } from 'elliptical'
import { URL } from 'lacona-phrases'

export const MyNewExtension = {
  extends: [URL],

  describe (${results.config ? '{config}' : ''}) {
    return (
      <literal
        text='my homepage'
        value=${results.config
          ? `{config.${configify(results.name)}.homepage}`
          : "'http://lacona.io'"} />
    )
  }
}

export default [MyNewExtension]
`
  }
}

function generateExtensionsSource (results) {
  if (results.type === 'command') {
    return `var elliptical = require('elliptical')
var laconaPhrases = require('lacona-phrases')
var laconaAPI = require('lacona-api')
var literal = elliptical.createElement.bind(null, 'literal')

var MyNewCommand = {
  extends: [laconaPhrases.Command],

  execute: function execute (result) {
    console.log('executing MyNewCommand')
    laconaAPI.runApplescript(\`display alert $\{result\}!\`)
  },

  describe: function describe (${results.config ? 'model' : ''}) {
    return literal({
      text: 'test my new command',
      value: ${results.config
        ? `model.config.${configify(results.name)}.message`
        : "'http://lacona.io'"}
    })
  }
}

exports.default = [MyNewCommand]
`
  } else { //extension
    return `var elliptical = require('elliptical')
var laconaPhrases = require('lacona-phrases')
var literal = elliptical.createElement.bind(null, 'literal')

var MyNewExtension = {
  extends: [URL],

  describe: function describe (${results.config ? 'model' : ''}) {
    return literal({
      text: 'my homepage',
      value: ${results.config
        ? `model.config.${configify(results.name)}.homepage`
        : "'http://lacona.io'"}
    })
  }
}

exports.default = [MyNewExtension]
`
  }
}

function generateConfig (results) {
  if (results.config && results.type === 'command') {
    return {
      [configify(results.name)]: {
        title: results.title,
        type: "object",
        properties: {
          message: {
            title: 'Alert message',
            type: 'string',
            default: 'Hello, world!'
          }
        }
      }
    }
  } else if (results.config && results.type === 'extensions') {
    return {
      [configify(results.name)]: {
        title: results.title,
        type: "object",
        properties: {
          homepage: {
            title: 'Homepage URL',
            type: 'string',
            default: 'http://lacona.io'
          }
        }
      }
    }
  } else {
    return {}
  }
}

function generatePackageJson (existing, results) {
  return _.assign({}, existing, {
    name: results.name,
    version: existing.version || '1.0.0',
    description: existing.description || results.description,
    main: existing.main || results.transpile
      ? 'build/extensions.js'
      : 'extensions.js',
    lacona: _.assign({}, existing.lacona, {
      title: results.title,
      description: results.description,
      extensions: existing.extensions || (
        results.transpile ? 'build/extensions.js' : 'extensions.js'
      ),
      config: existing.config || 'config.json'
    }),
    scripts: existing.scripts || (results.transpile
      ? {
        build: "mkdir -p build; browserify src/extensions.jsx -t babelify -o build/extensions.js -x lacona-phrases -x elliptical -x lacona-api --standalone extensions --extension=jsx",
        clean: "rimraf build",
        prepublish: "npm run clean && npm run build"
      } : {}
    ),
    keywords: existing.keywords || [
      'lacona',
      `lacona-${results.type}`
    ],
    license: results.license,
    repository: existing.repository || (results.repo
      ? {
        type: 'git',
        url: results.repo
      } : undefined
    ),
  "author": "@brandonhorst",
    devDependencies: existing.devDependencies || (results.transpile
      ? {
        'babel-plugin-transform-react-jsx': '^6.8.0',
        'babel-preset-es2015': '^6.9.0',
        'babelify': '^7.3.0',
        'browserify': '^13.0.1',
        'rimraf': '^2.5.2'
      } : {}
    ),
    babel: existing.babel || (
      results.transpile
        ? {
          presets: ['es2015'],
          plugins: ['transform-react-jsx']
        } : undefined
    )
  })
}

function npmify (title) {
  return _.kebabCase(_.deburr(title))
}

function configify (name) {
  if (_.startsWith(name, 'lacona-')) {
    return _.camelCase(name.slice(7))
  } else {
    return _.camelCase(name)
  }
}

// translated to sync from
// https://github.com/npm/init-package-json/blob/master/default-input.js
function defaultGitRepo () {
  let gconf
  try {
    const gconf = fs.readFileSync('.git/config', 'utf8')
  } catch (e) {
    return
  }

  if (!gconf) {
    return
  }

  const confLines = gconf.split(/\r?\n/)
  let i = confLines.indexOf('[remote "origin"]')
  let u
  if (i !== -1) {
    u = gconf[i + 1]
    if (!u.match(/^\s*url =/)) u = gconf[i + 2]
    if (!u.match(/^\s*url =/)) u = null
    else u = u.replace(/^\s*url = /, '')
  }

  if (u && u.match(/^git@github.com:/)) {
    u = u.replace(/^git@github.com:/, 'https://github.com/')
  }
  return u
}

function init (callback) {
  return inquirer.prompt([{
    name: 'title',
    message: 'Addon Title [for humans]:',
    default: pkgLacona.title,
  }, {
    name: 'name',
    message: 'Package Name [for computers]:',
    validate: (title) => {
      return npmSafeName(npmify(title))
        ? true
        : 'Name must be a valid npm package name'
    },
    default: (results) => {
      if (pkg.name) {
        return pkg.name
      } else {
        const npmified = npmify(results.title)
        if (npmSafeName(npmified)) {
          return `lacona-${npmified}`
        } else {
          return null
        }
      }
    }
  }, {
    name: 'description',
    message: 'Brief Description:',
    default: pkgLacona.description
  }, {
    name: 'type',
    type: 'list',
    message: 'Type:',
    choices: [
      {name: 'provide a new command', value: 'command', short: 'command'},
      {name: 'extend existing commands', value: 'extension', short: 'extension'}
    ],
    when: () => !pkgLacona.extensions
  }, {
    name: 'config',
    type: 'confirm',
    message: 'Include User Preferences?',
    when: () => !pkgLacona.config
  }, {
    name: 'transpile',
    type: 'confirm',
    default: true,
    message: 'Use Transpilation? [recommended, required to use npm packages]',
    when: () => !pkg.scripts && !pkgLacona.config && !pkgLacona.extensions
  }, {
    name: 'repo',
    message: 'git repository:',
    default: defaultGitRepo,
    when: () => !pkg.repository
  }, {
    name: 'license',
    message: 'license:',
    default: 'MIT',
    when: () => !pkg.license
  }, {
    name: 'confirm',
    type: 'confirm',
    default: true,
    message: 'Look good?'
  }]).then((obj) => {
    if (obj.confirm) {
      const newPackage = generatePackageJson(pkg, obj)
      jsonfile.writeFileSync('./package.json', newPackage, {spaces: 2})

      if (obj.type) {
        if (obj.transpile) {
          const source = generateExtensionsSourceTranspile(obj)
          fs.mkdirSync('./src')
          safeWriteFileSync('./src/extensions.jsx', source)
        } else {
          const source = generateExtensionsSource(obj)
          safeWriteFileSync('./extensions.js', source)
        }
      } 
      if (!_.isUndefined(obj.config)) {
        const newConfig = generateConfig(obj) 
        safeWriteFileSync('./config.json', newConfig, {spaces: 2}, jsonfile)
      }
    }
  })
}

function safeWriteFileSync (filename, content, options = {}, pkg = fs) {
  if (fs.existsSync(filename)) {
    console.log(`Refusing to overwrite existing ${filename}`)
  } else {
    pkg.writeFileSync(filename, content, options)
  }
}

function ls () {
  const packages = []
  const commandDirs = fs.readdirSync(userCommandsDir)
  for (let commandDirName of commandDirs) {
    const commandDir = path.join(userCommandsDir, commandDirName)
    const packageJSON = path.join(commandDir, 'package.json')
    let packageContents, packageObj
    try {
      packageContents = fs.readFileSync(packageJSON, {encoding: 'utf8'})
      packageObj = JSON.parse(packageContents)
    } catch (e) {
      continue
    }
    if (packageObj.lacona) {
      packages.push({
        name: packageObj.name,
        title: packageObj.lacona.title,
        version: packageObj.version
      })
    }
  }

  for (let pkg of packages) {
    console.log(`${pkg.title || 'Untitled'} (${pkg.name}@${pkg.version})`)
  }
}

function link () {
  console.log('Installing')
  childProcess.execSync('npm install', {encoding: 'utf8'})

  const newDir = path.join(userCommandsDir, pkg.name)
  try {
    const newDirStats = fs.lstatSync(newDir)
    if (newDirStats.isSymbolicLink()) {
      console.log(`Unlinking existing ${newDir}`)
      fs.unlinkSync(newDir)
    } else {
      console.log(`ERROR: Non-symlink exists at ${newDir}`)
      return
    }
  } catch (e) {
    // if the file doesn't exist, we don't care
  }

  console.log(`Symlinking to ${newDir}`)
  fs.symlinkSync(process.cwd(), newDir)
  console.log('Reloading Addons')
  childProcess.execSync(`osascript -e 'tell application "Lacona" to reload addons'`, {encoding: 'utf8'})
}

function install (packageName) {
  if (!packageName) {
    const newPath = path.join(userCommandsDir, pkg.name)

    rimraf.sync(newPath)
    fs.mkdirSync(newPath)

    fstreamNpm({path: process.cwd()})
      .pipe(fstream.Writer(newPath))
  } else { // package name provided
    request(
      `https://registry.npmjs.com/${packageName}/latest`,
      {json: true},
      (err, res, body) => {
        if (err) {
          console.log(`${packageName} could not be loaded from npm : ${err}`)
          return
        }
        const laconaInfo = body.lacona
        if (!laconaInfo) {
          console.log(`${packageName} is on npm, but is not a Lacona addon`)
          return
        }
        const tarballURL = body.dist.tarball
        const newPath = path.join(userCommandsDir, packageName)
        return request(tarballURL).pipe(
          tarPack.unpack(newPath, (err) => {
            if (err) {
              console.log(`Error unpacking code from ${packageName}`)
            } else {
              console.log(`${packageName} installed successfully`)
            }
          })
        )
      }
    )
  }
}

function uninstall (packageName = pkg.name) {
  const newPath = path.join(userCommandsDir, packageName)
  if (fs.existsSync(newPath)) {
    console.log(`Uninstalling addon ${packageName}`)
    rimraf.sync(newPath)
  }
}

function logs () {
  const output = childProcess.execSync('syslog | grep -i lacona', {encoding: 'utf8'})
  console.log(output)
}

commander
  .version(pkg.version)

commander
  .command('init')
  .description('initialize a new Lacona command in this directory')
  .action(init)

commander
  .command('ls')
  .alias('list')
  .description('list installed packages')
  .action(ls)

commander
  .command('install [package]')
  .description('install the specified package (or the current directory)')
  .action(install)

commander
  .command('uninstall [package]')
  .description('uninstall the specified package (or the current directory)')
  .action(uninstall)

commander
  .command('logs')
  .description('view the system logs about Lacona')
  .action(logs)

commander.parse(process.argv)

if (!process.argv.slice(2).length) {
  commander.outputHelp()
}