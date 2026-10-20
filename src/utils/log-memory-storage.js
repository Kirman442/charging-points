// Adapter for @probe.gl/log's optional console configuration persistence.
// Keep console levels and warnings; avoid automatic browser storage probes.
export class LocalStorage {
  constructor(id, defaultConfig) {
    this.id = id
    this.storage = null
    this.config = defaultConfig
  }

  getConfiguration() {
    return this.config
  }

  setConfiguration(configuration) {
    Object.assign(this.config, configuration)
  }

  _loadConfiguration() {
    return this
  }
}
