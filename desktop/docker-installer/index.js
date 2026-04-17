// Public API of the docker-installer module.
// Keeping a thin re-export so main.js imports from one place.

const { getStrategy, DOCKER_DISPLAY_NAME } = require('./manifest')
const { checkDocker, hintKeyForState, isDockerDesktopRunning } = require('./check')
const { downloadUrlFor } = require('./download-url')
const { dockerDesktopPath } = require('./desktop-path')

module.exports = {
  getStrategy,
  DOCKER_DISPLAY_NAME,
  checkDocker,
  hintKeyForState,
  isDockerDesktopRunning,
  downloadUrlFor,
  dockerDesktopPath,
}
