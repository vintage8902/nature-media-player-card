const NATURE_MEDIA_PLAYER_CARD_VERSION = "0.2.0";

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
    return this._choicesOpen ? 4 : 3;
  }

  _storageKey() {
    const key = this.config.storage_key || this.config.entity || "default";
    return `nature-media-player-card:${key}:active`;
  }

  _getStoredEntityId() {
    try {
      return window.localStorage.getItem(this._storageKey());
    } catch (_err) {
      return null;
    }
  }

  _storeEntityId(entityId) {
    if (!entityId) return;
    try {
      window.localStorage.setItem(this._storageKey(), entityId);
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

    players.sort((a, b) => new Date(b.last_changed).getTime() - new Date(a.last_changed).getTime());
    return players[0]?.entity_id || null;
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

    const latest = this._getLatestActivePlayerEntityId();
    if (latest) {
      this._storeEntityId(latest);
      return latest;
    }

    const stored = this._getStoredEntityId();
    if (stored && this._hass?.states?.[stored]) {
      return stored;
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
    const volumePct = Math.round(Math.max(0, Math.min(1, data.volume)) * 100);
    const choices = this.config.players
      .map((player) => {
        const selected = player.entity === data.activeEntity ? " selected" : "";
        return `
          <button class="choice${selected}" data-player="${player.entity}">
            <span class="choice-icon"><ha-icon icon="${player.icon || "mdi:speaker"}"></ha-icon></span>
            <span class="choice-name">${player.name || player.option || player.entity}</span>
          </button>
        `;
      })
      .join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          --nmp-primary: var(--primary-color, #1E3A2F);
          --nmp-surface: rgba(60, 94, 74, 0.72);
          --nmp-border: rgba(168, 196, 154, 0.13);
          --nmp-accent: #A8C49A;
          --nmp-light: #E9F1E8;
          --nmp-text: #EAD8B5;
          --nmp-muted: rgba(234, 216, 181, 0.72);
        }

        ha-card {
          height: ${this._choicesOpen ? "195px" : "195px"};
          background: var(--nmp-surface);
          border: 1px solid var(--nmp-border);
          border-radius: 26px;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.05),
            0 10px 24px rgba(0,0,0,0.16);
          overflow: hidden;
          box-sizing: border-box;
        }

        .header {
          position: relative;
          height: 62px;
          padding: 18px 56px 8px;
          box-sizing: border-box;
          text-align: center;
        }

        .source {
          position: absolute;
          left: 18px;
          top: 18px;
          width: 43px;
          height: 43px;
          border-radius: 50%;
          color: var(--nmp-text);
          background: rgba(168,196,154,0.16);
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
          color: var(--nmp-text);
          font-size: 16px;
          font-weight: 700;
          line-height: 20px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .artist {
          color: var(--nmp-muted);
          font-size: 12px;
          font-weight: 600;
          line-height: 16px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .controls {
          height: 66px;
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
          color: #F4F7F1;
          background: linear-gradient(145deg, rgba(168,196,154,0.45), rgba(233,241,232,0.18));
          border: 1px solid rgba(233, 241, 232, 0.32);
          box-shadow: 0 0 16px rgba(233, 241, 232, 0.18);
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
        }

        .volume ha-icon {
          width: 20px;
          height: 20px;
        }

        input[type="range"] {
          width: 100%;
          accent-color: var(--nmp-accent);
        }

        .choices {
          height: 106px;
          padding: 12px 8px 0;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: repeat(${Math.min(Math.max(this.config.players.length || 1, 1), 4)}, 1fr);
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
          width: 54px;
          height: 54px;
          border-radius: 50%;
          background: linear-gradient(145deg, rgba(168,196,154,0.22), rgba(46,79,61,0.58));
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(0,0,0,0.16);
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }

        .choice.selected .choice-icon {
          background: linear-gradient(145deg, rgba(168,196,154,0.45), rgba(233,241,232,0.18));
          border: 1px solid rgba(233,241,232,0.32);
        }

        .choice-icon ha-icon {
          width: 25px;
          height: 25px;
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
          <div class="title">${data.title}</div>
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
              <div class="volume">
                <ha-icon icon="mdi:volume-high"></ha-icon>
                <input class="volume-slider" type="range" min="0" max="100" value="${volumePct}" />
              </div>
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
  setConfig(config) {
    this.config = config;
    this.innerHTML = `
      <div style="padding: 16px;">
        Configure this card in YAML.
      </div>
    `;
  }
}

customElements.define("nature-media-player-card-editor", NatureMediaPlayerCardEditor);
