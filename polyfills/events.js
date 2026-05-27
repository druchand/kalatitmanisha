class EventEmitter {
  constructor() {
    this._events = {};
  }

  on(event, listener) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push(listener);
    return this;
  }

  addListener(event, listener) {
    return this.on(event, listener);
  }

  off(event, listener) {
    if (!this._events[event]) return this;
    this._events[event] = this._events[event].filter((fn) => fn !== listener);
    return this;
  }

  removeListener(event, listener) {
    return this.off(event, listener);
  }

  once(event, listener) {
    const wrapper = (...args) => {
      this.removeListener(event, wrapper);
      listener(...args);
    };
    this.on(event, wrapper);
    return this;
  }

  emit(event, ...args) {
    const listeners = this._events[event];
    if (!listeners) return false;
    listeners.slice().forEach((fn) => {
      fn(...args);
    });
    return true;
  }

  removeAllListeners(event) {
    if (event) {
      delete this._events[event];
    } else {
      this._events = {};
    }
    return this;
  }
}

module.exports = { EventEmitter };
