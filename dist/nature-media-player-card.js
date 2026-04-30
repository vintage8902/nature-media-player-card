const NATURE_MEDIA_PLAYER_CARD_VERSION = "0.4.15";

console.info(
  `%c NATURE-MEDIA-PLAYER-CARD %c v${NATURE_MEDIA_PLAYER_CARD_VERSION} `,
  "color: #EAD8B5; background: #1E3A2F; font-weight: 700;",
  "color: #1E3A2F; background: #A8C49A; font-weight: 700;",
);

class NatureMediaPlayerCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("nature-media-player-card-editor");
  }

  static getStubConfig() {
    return {
      players: [
        { entity: "media_player.kjokken", name: "Kjokken", icon: "mdi:stove", option: "Kjokken" },
      ],
    };
  }

  setConfig(config) {
    if (!config || (!config.entity && !Array.isArray(config.players))) {
      throw new Error("You need to define either an entity or players");
    }

    this.config = {
      show_selector: false,
      show_volume: true,
      ...config,
      players: Array.isArray(config.players) ? config.players : [],
    };
    this._choicesOpen = false;
    this.attachShadow({ mode: "open" });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    if (!this._choicesOpen) return this.config?.show_volume === false ? 2 : 3;
    const players = this.config?.players?.length || 1;
    return 3 + Math.max(1, Math.ceil(players / 4));
  }

  _storageKey() {
    const key = this.config.storage_key || this.config.entity || "default";
    return `nature-media-player-card:${key}:active`;
  }

  _storageTimeKey() {
    const key = this.config.storage_key || this.config.entity || "default";
    return `nature-media-player-card:${key}:active-time`;
  }

  _getStoredEntityId() {
    try {
      return window.localStorage.getItem(this._storageKey());
    } catch (_err) {
      return null;
    }
  }

  _getStoredTime() {
    try {
      return Number(window.localStorage.getItem(this._storageTimeKey()) || 0);
    } catch (_err) {
      return 0;
    }
  }

  _storeEntityId(entityId) {
    if (!entityId) return;
    try {
      window.localStorage.setItem(this._storageKey(), entityId);
      window.localStorage.setItem(this._storageTimeKey(), String(Date.now()));
    } catch (_err) {
      // localStorage can be unavailable in restricted browser modes.
    }
  }

  _isUsableMediaState(stateObj) {
    return stateObj && !["unknown", "unavailable", "off"].includes(stateObj.state);
  }

  _isActiveMediaState(stateObj) {
    return stateObj && !["unknown", "unavailable", "off", "idle"].includes(stateObj.state);
  }

  _getConfiguredPlayerEntities() {
    return this.config.players
      .map((player) => player.entity)
      .filter((entityId) => entityId && entityId.startsWith("media_player."));
  }

  _getLatestActivePlayerEntityId() {
    const players = this._getConfiguredPlayerEntities()
      .map((entityId) => this._hass?.states?.[entityId])
      .filter((stateObj) => this._isActiveMediaState(stateObj));

    players.sort((a, b) => this._getStateUpdatedTime(b) - this._getStateUpdatedTime(a));
    return players[0]?.entity_id || null;
  }

  _getStateUpdatedTime(stateObj) {
    if (!stateObj) return 0;
    return new Date(stateObj.last_updated || stateObj.last_changed).getTime();
  }

  _getActiveEntityId() {
    const stateObj = this.config.entity ? this._hass?.states?.[this.config.entity] : null;

    if (stateObj?.entity_id?.startsWith("media_player.")) {
      return stateObj.entity_id;
    }

    const active = stateObj?.state;
    if (active && active.startsWith("media_player.")) {
      this._storeEntityId(active);
      return active;
    }

    const stored = this._getStoredEntityId();
    if (stored && this._hass?.states?.[stored]) {
      const latest = this._getLatestActivePlayerEntityId();
      const latestChanged = latest
        ? this._getStateUpdatedTime(this._hass.states[latest])
        : 0;

      if (!latest || this._getStoredTime() >= latestChanged) {
        return stored;
      }

      this._storeEntityId(latest);
      return latest;
    }

    const latest = this._getLatestActivePlayerEntityId();
    if (latest) {
      this._storeEntityId(latest);
      return latest;
    }

    return this._getConfiguredPlayerEntities()[0] || null;
  }

  _getActivePlayer() {
    const activeEntity = this._getActiveEntityId();
    if (!activeEntity) return null;
    return this._hass?.states?.[activeEntity] || null;
  }

  _getDisplayData() {
    const source = this.config.entity ? this._hass?.states?.[this.config.entity] : null;
    const player = this._getActivePlayer();
    const activeEntity = this._getActiveEntityId();
    const configured = this.config.players.find((item) => item.entity === activeEntity) || {};

    const attrs = source?.entity_id?.startsWith("sensor.") ? source.attributes || {} : player?.attributes || {};
    const playerAttrs = player?.attributes || {};

    return {
      activeEntity,
      title: attrs.media_title || playerAttrs.media_title || this.config.empty_title || "Ingen media",
      artist: attrs.media_artist || playerAttrs.media_artist || "",
      state: attrs.player_state || player?.state || "off",
      volume: Number(attrs.volume_level ?? playerAttrs.volume_level ?? 0),
      icon: attrs.icon || configured.icon || this.config.icon || "mdi:speaker",
      name: configured.name || playerAttrs.friendly_name || activeEntity || "Mediaspiller",
    };
  }

  _callMediaService(service) {
    const entityId = this._getActiveEntityId();
    if (!entityId) return;
    this._hass.callService("media_player", service, {}, { entity_id: entityId });
  }

  _setVolume(value) {
    const entityId = this._getActiveEntityId();
    if (!entityId) return;
    this._hass.callService(
      "media_player",
      "volume_set",
      { volume_level: Number(value) },
      { entity_id: entityId },
    );
  }

  _selectPlayer(player) {
    if (player.entity) {
      this._storeEntityId(player.entity);
    }

    if (this.config.selector && player.option) {
      this._hass.callService(
        "input_select",
        "select_option",
        { option: player.option },
        { entity_id: this.config.selector },
      );
    } else if (this.config.selector && player.name) {
      this._hass.callService(
        "input_select",
        "select_option",
        { option: player.name },
        { entity_id: this.config.selector },
      );
    }

    this._choicesOpen = false;
    this._render();
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this.config) return;

    const data = this._getDisplayData();
    const playing = data.state === "playing";
    const showVolume = this.config.show_volume !== false;
    const volumePct = Math.round(Math.max(0, Math.min(1, data.volume)) * 100);
    const titleIsLong = String(data.title || "").length > 40;
    const choiceColumns = Math.min(Math.max(this.config.players.length || 1, 1), 4);
    const choiceRows = Math.max(1, Math.ceil((this.config.players.length || 1) / choiceColumns));
    const extraChoiceHeight = Math.max(0, choiceRows - 1) * 82;
    const controlHeight = showVolume ? 195 : 154;
    const cardHeight = this._choicesOpen ? 195 + extraChoiceHeight : controlHeight;
    const choicesHeight = 106 + extraChoiceHeight;
    const colors = {
      surface: "rgba(60, 94, 74, 0.72)",
      border: "rgba(168, 196, 154, 0.13)",
      accent: "#A8C49A",
      light: "#E9F1E8",
      text: "#EAD8B5",
      muted: "rgba(234, 216, 181, 0.72)",
      icon_background: "rgba(168, 196, 154, 0.16)",
      choice_background: "linear-gradient(145deg, rgba(168,196,154,0.22), rgba(46,79,61,0.58))",
      active_background: "linear-gradient(145deg, rgba(168,196,154,0.45), rgba(233,241,232,0.18))",
      active_border: "rgba(233, 241, 232, 0.32)",
      active_text: "#F4F7F1",
      shadow: "0 10px 24px rgba(0,0,0,0.16)",
      active_glow: "0 0 16px rgba(233, 241, 232, 0.18)",
      ...this.config.colors,
    };
    const choices = this.config.players
      .map((player) => {
        const selected = player.entity === data.activeEntity ? " selected" : "";
        const playerState = this._hass?.states?.[player.entity];
        const active = this._isActiveMediaState(playerState) ? " active" : "";
        const playerName =
          player.name || player.option || playerState?.attributes?.friendly_name || player.entity;
        return `
          <button class="choice${selected}${active}" data-player="${player.entity}">
            <span class="choice-icon">
              <ha-icon icon="${player.icon || "mdi:speaker"}"></ha-icon>
              <span class="choice-playing"><ha-icon icon="mdi:music-note"></ha-icon></span>
            </span>
            <span class="choice-name">${playerName}</span>
          </button>
        `;
      })
      .join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          overflow: hidden;
          box-sizing: border-box;
          contain: layout paint;
          --nmp-primary: var(--primary-color, #1E3A2F);
          --nmp-surface: ${colors.surface};
          --nmp-border: ${colors.border};
          --nmp-accent: ${colors.accent};
          --nmp-light: ${colors.light};
          --nmp-text: ${colors.text};
          --nmp-muted: ${colors.muted};
          --nmp-icon-background: ${colors.icon_background};
          --nmp-choice-background: ${colors.choice_background};
          --nmp-active-background: ${colors.active_background};
          --nmp-active-border: ${colors.active_border};
          --nmp-active-text: ${colors.active_text};
          --nmp-shadow: ${colors.shadow};
          --nmp-active-glow: ${colors.active_glow};
        }

        ha-card {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          height: ${cardHeight}px;
          background: var(--nmp-surface);
          border: 1px solid var(--nmp-border);
          border-radius: 26px;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.05),
            var(--nmp-shadow);
          overflow: hidden;
          box-sizing: border-box;
        }

        @media (max-width: 600px) {
          :host,
          ha-card {
            width: 100%;
            max-width: calc(100vw - 24px);
          }
        }

        .header {
          position: relative;
          height: 62px;
          padding: 18px 76px 8px;
          box-sizing: border-box;
          text-align: center;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          overflow: hidden;
        }

        .source {
          position: absolute;
          left: 18px;
          top: 18px;
          width: 43px;
          height: 43px;
          border-radius: 50%;
          color: var(--nmp-text);
          background: var(--nmp-icon-background);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .source ha-icon {
          width: 23px;
          height: 23px;
        }

        .menu {
          position: absolute;
          right: 14px;
          top: 14px;
          width: 32px;
          height: 32px;
          border: 0;
          padding: 0;
          background: transparent;
          color: var(--nmp-text);
          cursor: pointer;
        }

        .menu ha-icon {
          width: 22px;
          height: 22px;
        }

        .title {
          display: block;
          position: relative;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          height: 20px;
          color: var(--nmp-text);
          font-size: 16px;
          font-weight: 700;
          line-height: 20px;
          white-space: nowrap;
          overflow: hidden;
        }

        .title span {
          display: block;
          width: 100%;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .title.scrolling span {
          position: absolute;
          left: 0;
          top: 0;
          width: max-content;
          min-width: 0;
          max-width: none;
          overflow: visible;
          text-overflow: clip;
          animation: nmp-title-marquee var(--nmp-title-duration, 14s) ease-in-out infinite;
          will-change: transform;
        }

        @keyframes nmp-title-marquee {
          0%, 15% {
            transform: translateX(0);
          }
          45%, 65% {
            transform: translateX(calc(-1 * var(--nmp-title-distance, 0px)));
          }
          95%, 100% {
            transform: translateX(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .title.scrolling span {
            position: static;
            width: 100%;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            animation: none;
          }
        }

        .artist {
          display: block;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          color: var(--nmp-muted);
          font-size: 12px;
          font-weight: 600;
          line-height: 16px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .controls {
          height: ${showVolume ? 66 : 92}px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 24px;
        }

        .control {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 0;
          color: var(--nmp-text);
          background: transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .control ha-icon {
          width: 23px;
          height: 23px;
        }

        .play {
          width: 56px;
          height: 56px;
          color: var(--nmp-active-text);
          background: var(--nmp-active-background);
          border: 1px solid var(--nmp-active-border);
          box-shadow: var(--nmp-active-glow);
        }

        .volume {
          height: 40px;
          padding: 0 18px 14px;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: 28px 1fr;
          gap: 12px;
          align-items: center;
          color: var(--nmp-text);
          width: 100%;
          max-width: 100%;
          min-width: 0;
        }

        .volume ha-icon {
          width: 20px;
          height: 20px;
        }

        input[type="range"] {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          accent-color: var(--nmp-accent);
        }

        .choices {
          height: ${choicesHeight}px;
          padding: 12px 8px 0;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: repeat(${choiceColumns}, 1fr);
          grid-auto-rows: 76px;
          gap: 6px;
        }

        .choice {
          border: 0;
          background: transparent;
          color: var(--nmp-text);
          padding: 0;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 7px;
          font: inherit;
        }

        .choice-icon {
          position: relative;
          width: 54px;
          height: 54px;
          border-radius: 50%;
          background: var(--nmp-choice-background);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(0,0,0,0.16);
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }

        .choice.selected .choice-icon {
          background: var(--nmp-active-background);
          border: 1px solid var(--nmp-active-border);
        }

        .choice-icon ha-icon {
          width: 25px;
          height: 25px;
        }

        .choice-playing {
          position: absolute;
          right: -2px;
          top: -2px;
          width: 19px;
          height: 19px;
          border-radius: 50%;
          display: none;
          align-items: center;
          justify-content: center;
          color: var(--nmp-active-text);
          background: var(--nmp-accent);
          box-shadow: 0 0 10px rgba(168, 196, 154, 0.28);
        }

        .choice-playing ha-icon {
          width: 12px;
          height: 12px;
        }

        .choice.active .choice-playing {
          display: flex;
        }

        .choice-name {
          font-size: 11px;
          line-height: 13px;
          font-weight: 700;
          max-width: 72px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>

      <ha-card>
        <div class="header">
          <div class="source"><ha-icon icon="${data.icon}"></ha-icon></div>
          <button class="menu" aria-label="Velg mediaspiller"><ha-icon icon="mdi:dots-horizontal"></ha-icon></button>
          <div class="title${titleIsLong ? " scrolling" : ""}"><span>${data.title}</span></div>
          <div class="artist">${data.artist}</div>
        </div>

        ${
          this._choicesOpen
            ? `<div class="choices">${choices}</div>`
            : `
              <div class="controls">
                <button class="control previous" aria-label="Forrige"><ha-icon icon="mdi:skip-previous"></ha-icon></button>
                <button class="control play" aria-label="Spill av eller pause"><ha-icon icon="${playing ? "mdi:pause" : "mdi:play"}"></ha-icon></button>
                <button class="control next" aria-label="Neste"><ha-icon icon="mdi:skip-next"></ha-icon></button>
              </div>
              ${
                showVolume
                  ? `
                    <div class="volume">
                      <ha-icon icon="mdi:volume-high"></ha-icon>
                      <input class="volume-slider" type="range" min="0" max="100" value="${volumePct}" />
                    </div>
                  `
                  : ""
              }
            `
        }
      </ha-card>
    `;

    this.shadowRoot.querySelector(".menu")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._choicesOpen = !this._choicesOpen;
      this._render();
    });

    this.shadowRoot.querySelector(".previous")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._callMediaService("media_previous_track");
    });

    this.shadowRoot.querySelector(".play")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._callMediaService("media_play_pause");
    });

    this.shadowRoot.querySelector(".next")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._callMediaService("media_next_track");
    });

    this.shadowRoot.querySelector(".volume-slider")?.addEventListener("change", (ev) => {
      ev.stopPropagation();
      this._setVolume(Number(ev.target.value) / 100);
    });

    this.shadowRoot.querySelectorAll(".choice").forEach((button) => {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const entity = ev.currentTarget.dataset.player;
        const player = this.config.players.find((item) => item.entity === entity);
        if (player) this._selectPlayer(player);
      });
    });

    const title = this.shadowRoot.querySelector(".title.scrolling");
    const titleText = title?.querySelector("span");
    if (title && titleText) {
      requestAnimationFrame(() => {
        const distance = Math.max(0, titleText.scrollWidth - title.clientWidth);
        title.style.setProperty("--nmp-title-distance", `${distance}px`);
        title.style.setProperty("--nmp-title-duration", `${Math.max(12, Math.min(24, distance / 14))}s`);
        title.classList.toggle("scrolling", distance > 2);
      });
    }
  }
}

customElements.define("nature-media-player-card", NatureMediaPlayerCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "nature-media-player-card",
  name: "Nature Media Player Card",
  description: "Nature-inspired dynamic media player card",
});

class NatureMediaPlayerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    if (this.config && !this._renderedWithHass) this._render();
  }

  setConfig(config) {
    this.config = {
      players: [],
      colors: {},
      show_volume: true,
      ...config,
    };
    this._render();
  }

  _orderedConfig(config) {
    const { type, players, colors, ...rest } = config;
    const ordered = {
      type: type || "custom:nature-media-player-card",
      players: Array.isArray(players) ? players : [],
    };

    Object.entries(rest).forEach(([key, value]) => {
      if (value !== undefined) ordered[key] = value;
    });

    ordered.colors = colors || {};
    return ordered;
  }

  _defaultPlayerEntity() {
    return Object.keys(this._hass?.states || {}).find((entityId) => entityId.startsWith("media_player.")) || "";
  }

  _fireConfigChanged(config) {
    const orderedConfig = this._orderedConfig(config);
    this.config = orderedConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: orderedConfig },
        bubbles: true,
        composed: true,
      }),
    );
    this._render();
  }

  _setValue(key, value) {
    const config = { ...this.config };
    if (value === "" || value === null || value === undefined) {
      delete config[key];
    } else {
      config[key] = value;
    }
    this._fireConfigChanged(config);
  }

  _setColor(key, value) {
    const colors = { ...(this.config.colors || {}) };
    if (value === "" || value === null || value === undefined) {
      delete colors[key];
    } else {
      colors[key] = value;
    }

    const config = { ...this.config };
    if (Object.keys(colors).length) {
      config.colors = colors;
    } else {
      delete config.colors;
    }

    this._fireConfigChanged(config);
  }

  _setPlayer(index, key, value) {
    const players = [...(this.config.players || [])];
    players[index] = { ...(players[index] || {}) };

    if (value === "" || value === null || value === undefined) {
      delete players[index][key];
    } else {
      players[index][key] = value;
    }

    this._fireConfigChanged({ ...this.config, players });
  }

  _addPlayer() {
    const players = [...(this.config.players || [])];
    players.push({
      entity: this._defaultPlayerEntity(),
      name: "",
      icon: "mdi:speaker",
    });
    this._fireConfigChanged({ ...this.config, players });
  }

  _removePlayer(index) {
    const players = [...(this.config.players || [])];
    players.splice(index, 1);
    this._fireConfigChanged({ ...this.config, players });
  }

  _input(label, value, placeholder, onChange) {
    return `
      <label>
        <span>${label}</span>
        <input value="${this._escape(value || "")}" placeholder="${this._escape(placeholder || "")}">
      </label>
    `;
  }

  _checkbox(label, checked) {
    return `
      <label class="checkbox">
        <input type="checkbox" ${checked ? "checked" : ""}>
        <span>${label}</span>
      </label>
    `;
  }

  _entityPicker(label, value, index) {
    const mediaPlayers = Object.keys(this._hass?.states || {})
      .filter((entityId) => entityId.startsWith("media_player."))
      .sort((a, b) => {
        const aName = this._hass.states[a]?.attributes?.friendly_name || a;
        const bName = this._hass.states[b]?.attributes?.friendly_name || b;
        return aName.localeCompare(bName);
      });

    const selectedName = this._hass?.states?.[value]?.attributes?.friendly_name;
    const displayValue = selectedName ? `${selectedName} (${value})` : value || "";

    return `
      <label>
        <span>${label}</span>
        <div class="entity-combo" data-index="${index}">
          <input
            class="entity-input"
            value="${this._escape(displayValue)}"
            placeholder="Search media player"
            autocomplete="off"
          >
          <div class="entity-options">
            ${mediaPlayers
              .map((entityId) => {
                const name = this._hass.states[entityId]?.attributes?.friendly_name || entityId;
                return `
                  <button type="button" class="entity-option" data-entity="${this._escape(entityId)}">
                    <span>${this._escape(name)}</span>
                    <small>${this._escape(entityId)}</small>
                  </button>
                `;
              })
              .join("")}
          </div>
        </div>
      </label>
    `;
  }

  _iconPicker(label, value) {
    return `
      <label>
        <span>${label}</span>
        <ha-icon-picker
          class="icon-picker"
          value="${this._escape(value || "")}"
          label="${this._escape(label)}"
        ></ha-icon-picker>
      </label>
    `;
  }

  _escape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  _render() {
    if (!this.shadowRoot || !this.config) return;
    if (this._hass) this._renderedWithHass = true;

    const players = this.config.players || [];
    const colors = this.config.colors || {};
    const colorFields = [
      ["surface", "Surface"],
      ["border", "Border"],
      ["accent", "Accent"],
      ["light", "Light"],
      ["text", "Text"],
      ["muted", "Muted text"],
      ["icon_background", "Icon background"],
      ["choice_background", "Choice background"],
      ["active_background", "Active background"],
      ["active_border", "Active border"],
      ["active_text", "Active text"],
      ["shadow", "Shadow"],
      ["active_glow", "Active glow"],
    ];

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          color: var(--primary-text-color);
        }

        .editor {
          display: grid;
          gap: 18px;
          padding: 16px;
        }

        .section {
          display: grid;
          gap: 12px;
        }

        h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }

        label {
          display: grid;
          gap: 6px;
          font-size: 12px;
          color: var(--secondary-text-color);
        }

        .checkbox {
          min-height: 40px;
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--primary-text-color);
          font-size: 14px;
        }

        input,
        select,
        ha-icon-picker {
          width: 100%;
          box-sizing: border-box;
        }

        input,
        select {
          min-height: 56px;
          border: 0;
          border-bottom: 1px solid var(--primary-color);
          border-radius: 4px 4px 0 0;
          padding: 18px 16px 6px;
          background: var(--secondary-background-color, #303030);
          color: var(--primary-text-color);
          font: inherit;
          outline: none;
        }

        .checkbox input {
          width: 20px;
          min-height: 20px;
          padding: 0;
          border: 0;
          border-radius: 4px;
          background: transparent;
          accent-color: var(--primary-color);
        }

        input::placeholder {
          color: var(--secondary-text-color);
          opacity: 1;
        }

        input:focus,
        select:focus {
          border-bottom-color: var(--primary-color);
          box-shadow: inset 0 -1px 0 var(--primary-color);
        }

        .entity-combo {
          position: relative;
        }

        .entity-options {
          position: absolute;
          z-index: 10;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          max-height: 220px;
          overflow-y: auto;
          display: none;
          border: 0;
          border-radius: 0 0 4px 4px;
          background: var(--secondary-background-color, #303030);
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,0.24));
        }

        .entity-combo.open .entity-options {
          display: block;
        }

        .entity-option {
          width: 100%;
          display: grid;
          gap: 2px;
          padding: 9px 12px;
          border: 0;
          border-radius: 0;
          background: transparent;
          color: var(--primary-text-color);
          text-align: left;
          font-weight: 500;
        }

        .entity-option:hover,
        .entity-option:focus {
          background: var(--secondary-background-color);
        }

        .entity-option small {
          color: var(--secondary-text-color);
          font-size: 11px;
        }

        .entity-option[hidden] {
          display: none;
        }

        .player {
          display: grid;
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--divider-color);
          border-radius: 12px;
        }

        .player-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          font-weight: 600;
        }

        .icon-button {
          width: 36px;
          height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          padding: 0;
        }

        .icon-button ha-icon {
          width: 20px;
          height: 20px;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        button {
          border: 0;
          border-radius: 10px;
          padding: 10px 12px;
          background: var(--primary-color);
          color: var(--text-primary-color);
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }

        .ghost {
          background: transparent;
          color: var(--error-color);
        }

        details {
          border: 1px solid var(--divider-color);
          border-radius: 12px;
          padding: 12px;
        }

        summary {
          cursor: pointer;
          font-weight: 600;
        }

        .colors {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }
      </style>

      <div class="editor">
        <div class="section">
          <h3>General</h3>
          ${this._input("Empty title", this.config.empty_title, "Ingen media")}
          ${this._checkbox("Show volume", this.config.show_volume !== false)}
        </div>

        <div class="section">
          <h3>Players</h3>
          ${
            players.length
              ? players
                  .map(
                    (player, index) => `
                      <div class="player" data-index="${index}">
                        <div class="player-head">
                          <span>Player ${index + 1}</span>
                          <button class="ghost icon-button remove-player" data-index="${index}" aria-label="Remove player">
                            <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                          </button>
                        </div>
                        <div class="grid">
                          ${this._entityPicker("Entity", player.entity, index)}
                          ${this._input("Name (Optional)", player.name, "Uses the player name")}
                          ${this._iconPicker("Icon", player.icon)}
                        </div>
                      </div>
                    `,
                  )
                  .join("")
              : `<p>No players yet.</p>`
          }
          <button class="add-player">Add Player</button>
        </div>

        <details>
          <summary>Colors</summary>
          <div class="colors">
            ${colorFields
              .map(([key, label]) => this._input(label, colors[key], key === "accent" ? "#A8C49A" : ""))
              .join("")}
          </div>
        </details>
      </div>
    `;

    const generalInputs = this.shadowRoot.querySelectorAll(".section:first-child input");
    generalInputs[0]?.addEventListener("change", (ev) => this._setValue("empty_title", ev.target.value.trim()));
    generalInputs[1]?.addEventListener("change", (ev) => this._setValue("show_volume", ev.target.checked ? undefined : false));

    this.shadowRoot.querySelectorAll(".player").forEach((playerEl) => {
      const index = Number(playerEl.dataset.index);
      const combo = playerEl.querySelector(".entity-combo");
      const entityInput = combo?.querySelector(".entity-input");
      const entityOptions = combo?.querySelectorAll(".entity-option") || [];

      entityInput?.addEventListener("focus", () => combo.classList.add("open"));
      entityInput?.addEventListener("input", (ev) => {
        const query = ev.target.value.toLowerCase();
        combo.classList.add("open");
        entityOptions.forEach((option) => {
          option.hidden = !option.textContent.toLowerCase().includes(query);
        });
      });
      entityInput?.addEventListener("change", (ev) => {
        const value = ev.target.value.trim();
        const directEntity = value.match(/(media_player\.[^) ]+)/)?.[1] || value;
        this._setPlayer(index, "entity", directEntity);
      });
      entityOptions.forEach((option) => {
        option.addEventListener("click", (ev) => {
          ev.preventDefault();
          this._setPlayer(index, "entity", ev.currentTarget.dataset.entity);
        });
      });

      const keys = ["name"];
      playerEl.querySelectorAll("input").forEach((input, inputIndex) => {
        input.addEventListener("change", (ev) => this._setPlayer(index, keys[inputIndex], ev.target.value.trim()));
      });

      playerEl.querySelector(".icon-picker")?.addEventListener("value-changed", (ev) => {
        this._setPlayer(index, "icon", ev.detail?.value || "");
      });
    });

    this.shadowRoot.querySelectorAll(".remove-player").forEach((button) => {
      button.addEventListener("click", (ev) => this._removePlayer(Number(ev.currentTarget.dataset.index)));
    });

    this.shadowRoot.querySelector(".add-player")?.addEventListener("click", () => this._addPlayer());

    this.shadowRoot.querySelectorAll(".colors input").forEach((input, index) => {
      input.addEventListener("change", (ev) => this._setColor(colorFields[index][0], ev.target.value.trim()));
    });
  }
}

customElements.define("nature-media-player-card-editor", NatureMediaPlayerCardEditor);
