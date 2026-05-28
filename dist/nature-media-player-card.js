const NATURE_MEDIA_PLAYER_CARD_VERSION = "0.4.68-dev";

console.info(
  `%c NATURE-MEDIA-PLAYER-CARD-DEV %c v${NATURE_MEDIA_PLAYER_CARD_VERSION} `,
  "color: #EAD8B5; background: #1E3A2F; font-weight: 700;",
  "color: #1E3A2F; background: #A8C49A; font-weight: 700;",
);

class NatureMediaPlayerCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("nature-media-player-card-dev-editor");
  }

  static getStubConfig() {
    return {
      players: [
        { entity: "media_player.kjokken", icon: "mdi:stove" },
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
      show_cover_art: false,
      cover_art_layout: "center",
      cover_art_size: 160,
      show_shuffle_repeat: false,
      cover_art_attribute: "entity_picture",
      spotify_entity: "",
      shuffle_active_color: "",
      repeat_active_color: "",
      show_progress: true,
      idle_timeout_minutes: 0,
      pause_timeout_minutes: 0,
      show_playlist_images: true,
      playlist_display: "grid",
      playlist_columns: 4,
      playlist_image_size: 100,
      disable_collapse: false,
      ...config,
      players: Array.isArray(config.players) ? config.players : [],
      playlists: Array.isArray(config.playlists) ? config.playlists : [],
      spotify_playlists: Array.isArray(config.spotify_playlists) ? config.spotify_playlists : [],
      spotify_booleans: Array.isArray(config.spotify_booleans) ? config.spotify_booleans : [],
      speaker_extras: Array.isArray(config.speaker_extras) ? config.speaker_extras : [],
    };
    this._panel = "controls";
    this._shuffleRepeatMode = null;
    this._forceExpanded = false;
    this._lastKnownPosition = 0;
    this._lastKnownMediaPositionUpdatedAt = null;
    // Persists across config updates — keyed by entity_id, value is 0–1 volume level.
    // Used for players with local_volume: true whose HA state doesn't reliably reflect
    // the actual device volume (e.g. Alexa speaker groups).
    if (!this._localVolumes) this._localVolumes = {};
    // Tracks entities the user has explicitly switched away from. Stamped with Date.now()
    // so the card treats them as non-playing until HA state actually updates past the stamp
    // (self-healing). Prevents stale "playing" badges on Alexa speakers after switching rooms.
    if (!this._clearedStates) this._clearedStates = {};
    this.attachShadow({ mode: "open" });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    if (this._panel === "controls") {
      const baseSize = this.config?.show_volume === false ? 2 : 3;
      return this.config?.show_cover_art === true ? baseSize + 2 : baseSize;
    }
    const items = this._panel === "playlists"
      ? this.config?.playlists?.length || 1
      : this._panel === "spotify-playlists"
        ? this.config?.spotify_playlists?.length || 1
        : this.config?.players?.length || 1;
    return 3 + Math.max(1, Math.ceil(items / 4));
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
    // "on" is excluded — a TV/device that's powered on but not playing media should not
    // hijack the active player selection away from whatever is actually playing.
    return stateObj && !["unknown", "unavailable", "off", "idle", "on"].includes(stateObj.state);
  }

  // Returns true when the user has explicitly switched away from this entity and HA hasn't
  // reported a real state update since. Self-healing: once last_updated advances past the
  // clear timestamp the entry is deleted and HA state takes over again.
  _isStateCleared(entityId) {
    const clearedAt = this._clearedStates?.[entityId];
    if (!clearedAt) return false;
    const stateObj = this._hass?.states?.[entityId];
    if (!stateObj) return false;
    const lastUpdated = new Date(stateObj.last_updated || stateObj.last_changed).getTime();
    if (lastUpdated > clearedAt) {
      delete this._clearedStates[entityId];
      return false;
    }
    return true;
  }

  _getConfiguredPlayerEntities() {
    return this.config.players
      .map((player) => player.entity)
      .filter((entityId) => entityId && entityId.startsWith("media_player."));
  }

  _getLatestActivePlayerEntityId() {
    const players = this._getConfiguredPlayerEntities()
      .map((entityId) => this._hass?.states?.[entityId])
      .filter((stateObj) => this._isActiveMediaState(stateObj) && !this._isStateCleared(stateObj?.entity_id));

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

  _getConfiguredPlayer(entityId) {
    return this.config.players.find((item) => item.entity === entityId) || {};
  }

  _getDisplayData() {
    const source = this.config.entity ? this._hass?.states?.[this.config.entity] : null;
    const player = this._getActivePlayer();
    const activeEntity = this._getActiveEntityId();
    const configured = this._getConfiguredPlayer(activeEntity);

    const attrs = source?.entity_id?.startsWith("sensor.") ? source.attributes || {} : player?.attributes || {};
    const playerAttrs = player?.attributes || {};
    const coverAttribute = this.config.cover_art_attribute || "entity_picture";

    let mediaPosition = Number(attrs.media_position ?? playerAttrs.media_position ?? 0);
    let mediaDuration = Number(attrs.media_duration ?? playerAttrs.media_duration ?? 0);
    let mediaPositionUpdatedAt = attrs.media_position_updated_at || playerAttrs.media_position_updated_at || null;

    const spotifyEntityId = this.config.spotify_entity || this.config.spotify_player_entity;
    if (spotifyEntityId) {
      const spState = this._hass?.states?.[spotifyEntityId];
      const spAttrs = spState?.attributes || {};
      const activeCfg = this._getConfiguredPlayer(activeEntity);
      const isSpotifyContext = Boolean(activeCfg.spotify_source_name || activeCfg.source_name)
        || activeEntity === spotifyEntityId;
      if (isSpotifyContext && (spState?.state === "playing" || spState?.state === "paused")) {
        if (spAttrs.media_position != null) mediaPosition = Number(spAttrs.media_position);
        if (spAttrs.media_duration != null) mediaDuration = Number(spAttrs.media_duration);
        if (spAttrs.media_position_updated_at) mediaPositionUpdatedAt = spAttrs.media_position_updated_at;
      }
    }

    return {
      activeEntity,
      title: attrs.media_title || playerAttrs.media_title
        || (this.config.empty_title !== undefined ? this.config.empty_title : "Ingen media"),
      artist: attrs.media_artist || playerAttrs.media_artist || "",
      state: attrs.player_state || player?.state || "off",
      volume: Number(attrs.volume_level ?? playerAttrs.volume_level ?? 0),
      muted: Boolean(attrs.is_volume_muted ?? playerAttrs.is_volume_muted ?? false),
      shuffle: this._isShuffleOn(attrs.shuffle ?? playerAttrs.shuffle),
      repeat: attrs.repeat || playerAttrs.repeat || "off",
      icon: configured.icon || attrs.icon || this.config.icon || "mdi:speaker",
      name: configured.name || playerAttrs.friendly_name || activeEntity || "Mediaspiller",
      coverArt: attrs[coverAttribute] || playerAttrs[coverAttribute] || "",
      mediaPosition,
      mediaDuration,
      mediaPositionUpdatedAt,
      lastChanged: player?.last_changed || null,
    };
  }

  _isTimedOut() {
    const timeoutMinutes = Number(this.config.idle_timeout_minutes || 0);
    if (!timeoutMinutes || this._forceExpanded) return false;
    const data = this._getDisplayData();
    if (data.state === "playing") {
      this._forceExpanded = false;
      return false;
    }
    const lastChanged = data.lastChanged ? new Date(data.lastChanged).getTime() : 0;
    if (!lastChanged) return false;
    return (Date.now() - lastChanged) > timeoutMinutes * 60 * 1000;
  }

  _isPauseTimedOut() {
    const timeoutMinutes = Number(this.config.pause_timeout_minutes || 0);
    if (!timeoutMinutes || this._forceExpanded) return false;
    const data = this._getDisplayData();
    if (data.state === "playing") {
      this._forceExpanded = false;
      return false;
    }
    if (!["paused", "idle"].includes(data.state)) return false;
    const lastChanged = data.lastChanged ? new Date(data.lastChanged).getTime() : 0;
    if (!lastChanged) return false;
    return (Date.now() - lastChanged) > timeoutMinutes * 60 * 1000;
  }

  _callMediaService(service) {
    const entityId = this._getActiveEntityId();
    if (!entityId) return;
    this._hass.callService("media_player", service, {}, { entity_id: entityId });
  }

  _setVolume(value) {
    const entityId = this._getActiveEntityId();
    if (!entityId) return;
    // If this player uses local volume tracking, cache the value so the slider
    // doesn't snap back to stale HA state on the next re-render.
    const playerCfg = this._getConfiguredPlayer(entityId);
    if (playerCfg.local_volume) {
      this._localVolumes[entityId] = Number(value);
    }
    this._hass.callService(
      "media_player",
      "volume_set",
      { volume_level: Number(value) },
      { entity_id: entityId },
    );
  }

  _toggleMute(currentMuted) {
    const entityId = this._getActiveEntityId();
    if (!entityId) return;
    this._hass.callService(
      "media_player",
      "volume_mute",
      { is_volume_muted: !currentMuted },
      { entity_id: entityId },
    );
  }

  _isRepeatOn(repeat) {
    return !["off", "none", "false", ""].includes(String(repeat || "").toLowerCase());
  }

  _isShuffleOn(shuffle) {
    return ["true", "on", "yes", "1"].includes(String(shuffle ?? false).toLowerCase());
  }

  _getShuffleIcon(shuffleOn) {
    return shuffleOn ? "mdi:shuffle" : "mdi:shuffle-disabled";
  }

  _getRepeatMode(repeat) {
    const r = String(repeat || "").toLowerCase();
    if (r === "one" || r === "track") return "one";
    if (this._isRepeatOn(r)) return "all";
    return "off";
  }

  _getNextRepeatMode(current) {
    if (current === "off") return "all";
    if (current === "all") return "one";
    return "off";
  }

  _getRepeatIcon(repeat) {
    const mode = this._getRepeatMode(repeat);
    if (mode === "one") return "mdi:repeat-once";
    if (mode === "all") return "mdi:repeat";
    return "mdi:repeat-off";
  }

  _getShuffleRepeatMode(data) {
    const shuffle = data.shuffle === true;
    const repeat = this._isRepeatOn(data.repeat);
    if (shuffle && repeat) return "both";
    if (repeat) return "repeat";
    if (shuffle) return "shuffle";
    return "off";
  }

  _getDesiredShuffleRepeatMode(data) {
    return this._shuffleRepeatMode || this._getShuffleRepeatMode(data);
  }

  _getShuffleRepeatSettings(mode) {
    return {
      shuffle: mode === "shuffle" || mode === "both",
      repeat: mode === "repeat" || mode === "both" ? "all" : "off",
    };
  }

  _getSpotifyPlusRepeatState(repeat) {
    if (repeat === "one" || repeat === "track") return "track";
    if (repeat === "all" || repeat === "context") return "context";
    return "off";
  }

  async _callSpotifyPlusShuffleRepeat(entityId, deviceId, shuffle, repeat) {
    if (!entityId) return;

    const shuffleData = {
      entity_id: entityId,
      state: shuffle,
      delay: 0.5,
    };
    const repeatData = {
      entity_id: entityId,
      state: this._getSpotifyPlusRepeatState(repeat),
      delay: 0.5,
    };

    if (deviceId) {
      shuffleData.device_id = deviceId;
      repeatData.device_id = deviceId;
    }

    await this._hass.callService("spotifyplus", "player_set_repeat_mode", repeatData);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await this._hass.callService("spotifyplus", "player_set_shuffle_mode", shuffleData);
  }

  async _transferSpotifyPlayback(entityId, deviceId) {
    if (!entityId || !deviceId) return;

    await this._hass.callService("spotifyplus", "player_transfer_playback", {
      entity_id: entityId,
      device_id: deviceId,
      play: true,
      delay: 1,
      force_activate_device: true,
    });
  }

  // Fix: use SpotifyPlus services when active player IS the spotify entity (no sourceName needed)
  async _toggleShuffle(data) {
    const entityId = this._getActiveEntityId();
    if (!entityId) return;

    const newShuffle = !data.shuffle;
    const activePlayer = this._getConfiguredPlayer(entityId);
    const sourceName = activePlayer.spotify_source_name || activePlayer.source_name;
    const spotifyEntityId = this.config.spotify_entity || this.config.spotify_player_entity;

    const activeIsSpotifyShuffle = entityId === spotifyEntityId;
    if (spotifyEntityId && (sourceName || activeIsSpotifyShuffle)) {
      await this._callSpotifyPlusShuffleRepeat(
        spotifyEntityId,
        activeIsSpotifyShuffle ? null : sourceName,
        newShuffle,
        data.repeat,
      );
    } else {
      await this._hass.callService("media_player", "shuffle_set", { shuffle: newShuffle }, { entity_id: entityId });
    }

    this._render();
  }

  // Fix: use SpotifyPlus services when active player IS the spotify entity
  async _cycleRepeat(data) {
    const entityId = this._getActiveEntityId();
    if (!entityId) return;

    const currentMode = this._getRepeatMode(data.repeat);
    const nextMode = this._getNextRepeatMode(currentMode);
    const repeatValue = nextMode === "one" ? "one" : nextMode === "all" ? "all" : "off";

    const activePlayer = this._getConfiguredPlayer(entityId);
    const sourceName = activePlayer.spotify_source_name || activePlayer.source_name;
    const spotifyEntityId = this.config.spotify_entity || this.config.spotify_player_entity;

    const activeIsSpotifyRepeat = entityId === spotifyEntityId;
    if (spotifyEntityId && (sourceName || activeIsSpotifyRepeat)) {
      await this._callSpotifyPlusShuffleRepeat(
        spotifyEntityId,
        activeIsSpotifyRepeat ? null : sourceName,
        data.shuffle,
        repeatValue,
      );
    } else {
      await this._hass.callService("media_player", "repeat_set", { repeat: repeatValue }, { entity_id: entityId });
    }

    this._render();
  }

  _getNextShuffleRepeatMode(mode) {
    if (mode === "off") return "shuffle";
    if (mode === "shuffle") return "repeat";
    if (mode === "repeat") return "both";
    return "off";
  }

  _getShuffleRepeatIcon(mode) {
    if (mode === "both") return "mdi:all-inclusive";
    if (mode === "repeat") return "mdi:repeat";
    if (mode === "shuffle") return "mdi:shuffle";
    return "mdi:shuffle-disabled";
  }

  async _cycleShuffleRepeat(data) {
    const entityId = this._getActiveEntityId();
    if (!entityId) return;

    const nextMode = this._getNextShuffleRepeatMode(this._getDesiredShuffleRepeatMode(data));
    const { shuffle, repeat } = this._getShuffleRepeatSettings(nextMode);
    this._shuffleRepeatMode = nextMode;

    const activePlayer = this._getConfiguredPlayer(entityId);
    const sourceName = activePlayer.spotify_source_name || activePlayer.source_name;
    const spotifyEntityId = this.config.spotify_entity || this.config.spotify_player_entity;

    if (spotifyEntityId && sourceName) {
      await this._callSpotifyPlusShuffleRepeat(spotifyEntityId, sourceName, shuffle, repeat);
    } else {
      await this._hass.callService("media_player", "repeat_set", { repeat }, { entity_id: entityId });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await this._hass.callService("media_player", "shuffle_set", { shuffle }, { entity_id: entityId });
    }

    this._render();
  }

  async _playMusicAssistantPlaylist(playlist) {
    const entityId = this._getActiveEntityId();
    const mediaId = playlist?.media_id || playlist?.source;
    if (!entityId || !mediaId) return;

    const data = {
      media_id: mediaId,
      media_type: "playlist",
    };
    const displayData = this._getDisplayData();
    const mode = this.config.show_shuffle_repeat === true
      ? this._getDesiredShuffleRepeatMode(displayData)
      : this.config.shuffle_playlists === true ? "shuffle" : "off";
    const { shuffle, repeat } = this._getShuffleRepeatSettings(mode);

    await this._hass.callService("media_player", "repeat_set", { repeat }, { entity_id: entityId });
    await new Promise((resolve) => setTimeout(resolve, 150));

    await this._hass.callService("music_assistant", "play_media", data, { entity_id: entityId });
    await new Promise((resolve) => setTimeout(resolve, 350));
    this._hass.callService("media_player", "shuffle_set", { shuffle }, { entity_id: entityId });
  }

  _normalizeSpotifyPlaylistUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const urlMatch = raw.match(/playlist\/([A-Za-z0-9]+)/);
    if (urlMatch?.[1]) return `https://open.spotify.com/playlist/${urlMatch[1]}`;
    if (raw.startsWith("spotify:playlist:")) {
      return `https://open.spotify.com/playlist/${raw.replace("spotify:playlist:", "")}`;
    }
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return `https://open.spotify.com/playlist/${raw}`;
  }

  async _playSpotifyPlaylist(playlist) {
    const activeEntityId = this._getActiveEntityId();
    const spotifyEntityId = this.config.spotify_entity || this.config.spotify_player_entity;
    const mediaContentId = this._normalizeSpotifyPlaylistUrl(
      playlist?.playlist_url || playlist?.media_content_id || playlist?.media_id,
    );
    if (!spotifyEntityId || !mediaContentId) return;

    const activeIsSpotifyEntity = activeEntityId === spotifyEntityId;
    const activePlayer = this._getConfiguredPlayer(activeEntityId);
    const sourceName = activePlayer.spotify_source_name || activePlayer.source_name;

    const displayData = this._getDisplayData();
    const mode = this.config.show_shuffle_repeat === true
      ? this._getDesiredShuffleRepeatMode(displayData)
      : this.config.shuffle_playlists === true ? "shuffle" : "off";
    const { shuffle, repeat } = this._getShuffleRepeatSettings(mode);

    if (!activeIsSpotifyEntity && sourceName) {
      try {
        await this._transferSpotifyPlayback(spotifyEntityId, sourceName);
        await new Promise((resolve) => setTimeout(resolve, 500));
        await this._callSpotifyPlusShuffleRepeat(spotifyEntityId, sourceName, shuffle, repeat);
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (_e) {
        // Transfer failed — still attempt play_media below.
      }
    } else {
      await this._callSpotifyPlusShuffleRepeat(spotifyEntityId, null, shuffle, repeat);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    await this._hass.callService(
      "media_player",
      "play_media",
      {
        media_content_id: mediaContentId,
        media_content_type: "playlist",
      },
      { entity_id: spotifyEntityId },
    );
  }

  async _playSpotifyBooleanToggle(playlist) {
    const entityId = playlist?.entity;
    if (!entityId) return;
    const state = this._hass?.states?.[entityId]?.state;
    const service = state === "on" ? "turn_off" : "turn_on";
    await this._hass.callService("input_boolean", service, {}, { entity_id: entityId });
  }

  _selectPlayer(player) {
    // Stamp the entity we're leaving so its stale "playing" state doesn't persist in the UI.
    const prevEntityId = this._getActiveEntityId();
    if (prevEntityId && prevEntityId !== player.entity) {
      this._clearedStates[prevEntityId] = Date.now();
    }

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

    this._panel = "controls";
    this._render();
  }

  async _castToPlayer(targetPlayer) {
    const currentEntityId = this._getActiveEntityId();
    const targetEntityId = targetPlayer.entity;
    if (!targetEntityId || targetEntityId === currentEntityId) return;

    const spotifyEntityId = this.config.spotify_entity || this.config.spotify_player_entity;
    const targetConfig = this._getConfiguredPlayer(targetEntityId);
    const targetSourceName = targetConfig.spotify_source_name || targetConfig.source_name;

    if (spotifyEntityId && targetSourceName) {
      await this._transferSpotifyPlayback(spotifyEntityId, targetSourceName);
    } else {
      const targetState = this._hass?.states?.[targetEntityId];
      const supportedFeatures = Number(targetState?.attributes?.supported_features || 0);
      const supportsJoin = (supportedFeatures & 524288) !== 0;
      const supportsPlayMedia = (supportedFeatures & 512) !== 0;

      await this._hass.callService("media_player", "turn_on", {}, { entity_id: targetEntityId });
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (supportsJoin) {
        try {
          await this._hass.callService(
            "media_player",
            "join",
            { group_members: [targetEntityId] },
            { entity_id: currentEntityId },
          );
        } catch (_e) {
          // join failed despite feature flag — selection switches below
        }
      } else if (supportsPlayMedia) {
        const currentState = this._hass?.states?.[currentEntityId];
        const currentAttrs = currentState?.attributes || {};
        if (currentAttrs.media_content_id && currentAttrs.media_content_type) {
          try {
            await this._hass.callService(
              "media_player",
              "play_media",
              {
                media_content_id: currentAttrs.media_content_id,
                media_content_type: currentAttrs.media_content_type,
              },
              { entity_id: targetEntityId },
            );
          } catch (_e) {
            // play_media failed — just switch selection
          }
        }
      }
    }
    this._storeEntityId(targetEntityId);
    // Stamp the entity we cast away from so its stale state doesn't linger in the UI.
    this._clearedStates[currentEntityId] = Date.now();
    this._panel = "controls";
    this._render();
  }

  _selectPlaylist(playlist, type = "music-assistant") {
    if (type === "spotify") {
      this._playSpotifyPlaylist(playlist);
    } else if (type === "boolean") {
      this._playSpotifyBooleanToggle(playlist);
    } else {
      this._playMusicAssistantPlaylist(playlist);
    }
    this._panel = "controls";
    this._render();
  }

  _getNextPlaylistPanel(playlists = this.config.playlists, spotifyPlaylists = this.config.spotify_playlists, booleans = this.config.spotify_booleans) {
    const hasMusicAssistant = Array.isArray(playlists)
      && playlists.some((item) => item?.media_id || item?.source);
    const hasSpotify = (Array.isArray(spotifyPlaylists)
      && spotifyPlaylists.some((item) => item?.playlist_url || item?.media_content_id || item?.media_id))
      || (Array.isArray(booleans) && booleans.some((b) => b?.entity));

    if (this._panel === "controls") {
      if (hasMusicAssistant) return "playlists";
      if (hasSpotify) return "spotify-playlists";
      return "controls";
    }

    if (this._panel === "playlists") {
      return hasSpotify ? "spotify-playlists" : "controls";
    }

    return "controls";
  }

  _escape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  _renderCollapsedHeader(data, colors) {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; box-sizing: border-box; }
        ha-card {
          width: 100%; height: 80px;
          background: ${colors.surface};
          border: 1px solid ${colors.border};
          border-radius: 26px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), ${colors.shadow};
          overflow: hidden; box-sizing: border-box; cursor: pointer;
          display: block;
        }
        ha-card:active { opacity: 0.85; }
        .header {
          position: relative; height: 80px;
          padding: 22px 76px 8px 76px;
          box-sizing: border-box; text-align: center; overflow: hidden;
        }
        .source {
          position: absolute; left: 18px; top: 18px;
          width: 43px; height: 43px; border-radius: 50%;
          color: ${colors.text}; background: ${colors.icon_background};
          display: flex; align-items: center; justify-content: center;
          pointer-events: none;
        }
        .source ha-icon { width: 23px; height: 23px; }
        .title {
          display: block; height: 20px;
          color: ${colors.text}; font-size: 16px; font-weight: 700;
          line-height: 20px; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        }
        .artist {
          display: block; color: ${colors.muted};
          font-size: 12px; font-weight: 600; line-height: 16px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
      </style>
      <ha-card>
        <div class="header">
          <span class="source"><ha-icon icon="${data.icon}"></ha-icon></span>
          <div class="title">${this._escape(data.title)}</div>
          <div class="artist">${this._escape(data.artist)}</div>
        </div>
      </ha-card>
    `;
    this.shadowRoot.querySelector("ha-card")?.addEventListener("click", () => {
      this._forceExpanded = true;
      this._render();
    });
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this.config) return;

    if (this._cancelProgressRaf) {
      this._cancelProgressRaf();
      this._cancelProgressRaf = null;
    }

    const data = this._getDisplayData();

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

    if (!this.config.disable_collapse && this._isTimedOut()) {
      this._renderCollapsedHeader(data, colors);
      return;
    }

    if (!this.config.disable_collapse && this._isPauseTimedOut()) {
      this._renderCollapsedHeader(data, colors);
      return;
    }

    const playing = data.state === "playing";
    const showVolume = this.config.show_volume !== false;
    const showCoverArt = this.config.show_cover_art === true && Boolean(data.coverArt);
    const coverArtLayout = this.config.cover_art_layout === "left" ? "left" : "center";
    const coverArtLeft = showCoverArt && coverArtLayout === "left";
    const showShuffleRepeat = this.config.show_shuffle_repeat === true;
    const showProgress = this.config.show_progress !== false;
    const coverArtSize = Math.max(40, Number(this.config.cover_art_size || 160));
    const showPlaylistImages = this.config.show_playlist_images !== false;
    const playlistDisplay = this.config.playlist_display === "row" ? "row" : "grid";
    const playlistColumns = Math.min(6, Math.max(1, Number(this.config.playlist_columns || 4)));
    const playlistImageSize = Math.min(200, Math.max(40, Number(this.config.playlist_image_size || 100)));

    const playlists = Array.isArray(this.config.playlists)
      ? this.config.playlists.filter((item) => item?.media_id || item?.source)
      : [];
    const spotifyPlaylists = Array.isArray(this.config.spotify_playlists)
      ? this.config.spotify_playlists.filter((item) => item?.playlist_url || item?.media_content_id || item?.media_id)
      : [];

    const hasExplicitPlaylistSetting = this.config.players.some((player) =>
      Object.prototype.hasOwnProperty.call(player, "show_playlists"),
    );
    const activePlayerConfig = this._getConfiguredPlayer(data.activeEntity);
    const activePlayerHasSpotifySource = Boolean(
      activePlayerConfig.spotify_source_name || activePlayerConfig.source_name,
    );

    const activeIsSpotifyEntity = data.activeEntity === (this.config.spotify_entity || this.config.spotify_player_entity);
    const availableSpotifyPlaylists = (activePlayerHasSpotifySource || activeIsSpotifyEntity)
      ? spotifyPlaylists
      : [];

    const spotifyBooleans = (activePlayerHasSpotifySource || activeIsSpotifyEntity)
      ? this.config.spotify_booleans.filter((b) => b?.entity)
      : [];

    const activePlayerAllowsMusicAssistantPlaylists =
      activePlayerConfig.show_playlists === true ||
      (!hasExplicitPlaylistSetting && playlists.length > 0);
    const availablePlaylists = activePlayerAllowsMusicAssistantPlaylists ? playlists : [];
    const allPlaylists = [...availablePlaylists, ...availableSpotifyPlaylists, ...spotifyBooleans];

    // ── Currently-playing playlist detection ─────────────────────────────────
    const extractPlaylistId = (value) => {
      const m = String(value || "").match(/playlist[/:]([\w]+)/);
      return m?.[1] || "";
    };

    const spotifyEntityId = this.config.spotify_entity || this.config.spotify_player_entity;
    const spotifyState = spotifyEntityId ? this._hass?.states?.[spotifyEntityId] : null;
    const spotifyAttrs = spotifyState?.attributes || {};
    const currentSpotifyPlaylistId = extractPlaylistId(
      spotifyAttrs.media_context_content_id ||
      spotifyAttrs.sp_playlist_uri ||
      spotifyAttrs.media_playlist_content_id || "",
    );
    const isSpotifyPlaying = spotifyState?.state === "playing" && Boolean(currentSpotifyPlaylistId);

    const showPlaylistBtn = allPlaylists.length > 0;

    if (
      (this._panel === "playlists" && !availablePlaylists.length)
      || (this._panel === "spotify-playlists" && !availableSpotifyPlaylists.length && !spotifyBooleans.length)
      || this._panel === "cast"
      || this._panel === "menu-playlists"
    ) {
      this._panel = "controls";
    }

    const volumePct = Math.round(Math.max(0, Math.min(1, (() => {
      const activeCfg = this._getConfiguredPlayer(data.activeEntity);
      return (activeCfg.local_volume && this._localVolumes[data.activeEntity] != null)
        ? this._localVolumes[data.activeEntity]
        : data.volume;
    })())) * 100);
    const volumeIcon = data.muted ? "mdi:volume-off" : "mdi:volume-high";

    const shuffleOn = data.shuffle === true;
    const shuffleIcon = this._getShuffleIcon(shuffleOn);
    const repeatMode = this._getRepeatMode(data.repeat);
    const repeatIcon = this._getRepeatIcon(data.repeat);

    const titleIsLong = String(data.title || "").length > 40;
    const playlistPanel = this._panel === "playlists" || this._panel === "spotify-playlists";
    const isPlaylistTilePanel = playlistPanel;
    const playlistPanelActive = playlistPanel;

    const panelItems = this._panel === "playlists"
      ? availablePlaylists
      : this._panel === "spotify-playlists"
        ? availableSpotifyPlaylists
        : this.config.players;

    // Fix #2: use playlistColumns for playlist panels; auto-size for player panel
    const choiceColumns = isPlaylistTilePanel
      ? playlistColumns
      : Math.min(Math.max(panelItems.length || 1, 1), 4);
    const choiceRows = Math.max(1, Math.ceil((panelItems.length || 1) / choiceColumns));
    const choiceRowHeight = isPlaylistTilePanel ? playlistImageSize + 28 : 76;
    const choicesBaseHeight = isPlaylistTilePanel ? playlistImageSize + 60 : 106;
    const playlistTitleHeight = isPlaylistTilePanel ? 28 : 0;
    // Fix #3: row layout collapses to a single horizontal scroll row — no extra rows
    const isRowLayout = isPlaylistTilePanel && playlistDisplay === "row";
    const extraChoiceHeight = isRowLayout ? 0 : Math.max(0, choiceRows - 1) * (choiceRowHeight + 6);

    // Fix #3: row layout is now a vertical scrollable list (icon left, name right)
    const rowThumbSize = Math.min(playlistImageSize, 48);
    const rowItemH = rowThumbSize + 14;
    const maxVisibleRowItems = 5;
    const rowChoicesH = Math.min(panelItems.length, maxVisibleRowItems) * rowItemH + 16;

    const showProgressBar = showProgress && !coverArtLeft && data.mediaDuration > 0;
    const progressBarHeight = showProgressBar ? 28 : 0;
    const coverArtContainerHeight = showCoverArt && !coverArtLeft ? coverArtSize + 12 : 0;
    const controlHeight = coverArtLeft
      ? (showVolume ? 222 : 180)
      : (showVolume ? 186 : 145) + coverArtContainerHeight + progressBarHeight;
    // Fix #5: player panel gets extra height for per-player volume rows
    const pvRowH = 44;
    const playerVolumeSectionHeight = this.config.players.length * pvRowH + 14;
    // ── Task 3: speaker extras height (pill row, ~52px per flex row) ──────────
    const speakerExtraRowH = 52;
    const speakerExtrasCount = this.config.speaker_extras.filter((e) => e?.entity).length;
    // Estimate rows: roughly 2-3 pills fit per row at min-width 64px + gap
    const speakerExtraRows = speakerExtrasCount > 0 ? Math.ceil(speakerExtrasCount / 3) : 0;
    const speakerExtrasHeight = speakerExtraRows > 0 ? speakerExtraRows * speakerExtraRowH : 0;
    const playlistPanelHeight = isRowLayout
      ? 89 + playlistTitleHeight + rowChoicesH + 12
      : 89 + playlistTitleHeight + choicesBaseHeight + extraChoiceHeight;
    const playerPanelHeight = 89 + choicesBaseHeight + extraChoiceHeight + playerVolumeSectionHeight + speakerExtrasHeight;
    const panelHeight = this._panel === "players" ? playerPanelHeight : playlistPanelHeight;
    // Don't shrink the card while music is actively playing — prevents janky resize when opening playlists
    const cardHeight = this._panel === "controls"
      ? controlHeight
      : (playing ? Math.max(panelHeight, controlHeight) : panelHeight);
    const choicesHeight = isRowLayout ? rowChoicesH : (choicesBaseHeight + extraChoiceHeight);

    // ── Player selector choices ───────────────────────────────────────────────
    const choices = this.config.players
      .map((player) => {
        const selected = player.entity === data.activeEntity ? " selected" : "";
        const playerState = this._hass?.states?.[player.entity];
        const isPlaying = playerState?.state === "playing" && !this._isStateCleared(player.entity);
        const active = isPlaying ? " active" : "";
        const playerName =
          player.name || playerState?.attributes?.friendly_name || player.option || player.entity;
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

    // Fix: per-player show_volume — rows with show_volume: false are omitted from overview
    const playerVolumesMarkup = `
      <div class="player-volumes">
        ${this.config.players.map((player) => {
          if (player.show_volume === false) return "";
          const pState = this._hass?.states?.[player.entity];
          const pAttrs = pState?.attributes || {};
          const rawVol = Number(pAttrs.volume_level ?? 0);
          const volPct = Math.round(Math.max(0, Math.min(1,
            (player.local_volume && this._localVolumes[player.entity] != null)
              ? this._localVolumes[player.entity]
              : rawVol,
          )) * 100);
          const muted = Boolean(pAttrs.is_volume_muted);
          const isUsable = this._isUsableMediaState(pState);
          const icon = player.icon || "mdi:speaker";
          const name = player.name || pAttrs.friendly_name || player.entity;
          const volIcon = muted ? "mdi:volume-off" : "mdi:volume-high";
          return `
            <div class="pvol-row${isUsable ? "" : " pvol-disabled"}" data-entity="${this._escape(player.entity)}">
              <ha-icon class="pvol-icon" icon="${this._escape(icon)}"></ha-icon>
              <span class="pvol-name">${this._escape(name)}</span>
              <input class="pvol-slider" type="range" min="0" max="100" value="${volPct}"${isUsable ? "" : " disabled"}>
              <button class="pvol-mute${muted ? " muted" : ""}" data-entity="${this._escape(player.entity)}"${isUsable ? "" : " disabled"}>
                <ha-icon icon="${this._escape(volIcon)}"></ha-icon>
              </button>
            </div>
          `;
        }).join("")}
      </div>
    `;

    // ── Task 3: Speaker extras (toggles / lights in speaker panel) ─────────────
    const speakerExtrasAbove = this.config.speaker_extras.filter((e) => e?.entity && e.position === "above");
    const speakerExtrasBelow = this.config.speaker_extras.filter((e) => e?.entity && e.position !== "above");

    const renderSpeakerExtra = (extra) => {
      const state = this._hass?.states?.[extra.entity];
      const isOn = state?.state === "on";
      const name = extra.name || state?.attributes?.friendly_name || extra.entity;
      const domain = extra.entity.split(".")[0];
      const defaultIcon = domain === "light" ? "mdi:lightbulb" : "mdi:toggle-switch-outline";
      const icon = extra.icon || defaultIcon;
      return `
        <button class="speaker-extra-btn${isOn ? " on" : ""}" data-entity="${this._escape(extra.entity)}">
          <span class="speaker-extra-icon-wrap">
            <ha-icon icon="${this._escape(icon)}"></ha-icon>
          </span>
          <span class="speaker-extra-label">${this._escape(name)}</span>
        </button>
      `;
    };

    const speakerExtrasAboveMarkup = speakerExtrasAbove.length
      ? `<div class="speaker-extras">${speakerExtrasAbove.map(renderSpeakerExtra).join("")}</div>`
      : "";
    const speakerExtrasBelowMarkup = speakerExtrasBelow.length
      ? `<div class="speaker-extras">${speakerExtrasBelow.map(renderSpeakerExtra).join("")}</div>`
      : "";

    // ── Playlist tile renderer ────────────────────────────────────────────────
    const renderPlaylistTile = (playlist, index, type = "music-assistant") => {
      const id = type === "boolean"
        ? playlist.entity
        : playlist.media_id || playlist.source || playlist.playlist_url || playlist.media_content_id;
      const name = playlist.name || playlist.title || id || "";
      const hasImage = Boolean(playlist.image) && showPlaylistImages;
      const icon = playlist.icon || (type === "boolean" ? "mdi:toggle-switch-outline" : type === "spotify" ? "mdi:spotify" : "mdi:playlist-music");

      let tileIsPlaying = false;
      if (type === "spotify" && isSpotifyPlaying) {
        const tileId = extractPlaylistId(playlist.playlist_url || playlist.media_content_id || playlist.media_id);
        tileIsPlaying = Boolean(tileId) && tileId === currentSpotifyPlaylistId;
      } else if (type === "boolean") {
        tileIsPlaying = this._hass?.states?.[playlist.entity]?.state === "on";
      }
      const playingClass = tileIsPlaying ? " active" : "";

      return `
        <button class="choice playlist-choice${hasImage ? " has-image" : ""}${playingClass}"
          data-playlist-index="${index}" data-playlist-type="${type}"
          style="${hasImage ? `--pl-image:url('${this._escape(playlist.image)}')` : ""}">
          ${hasImage
            ? `<span class="choice-image" style="width:${playlistImageSize}px;height:${playlistImageSize}px;">
                <span class="choice-playing"><ha-icon icon="mdi:music-note"></ha-icon></span>
                <span class="choice-name choice-name-over">${this._escape(name)}</span>
               </span>
               <span class="choice-row-name">${this._escape(name)}</span>`
            : `<span class="choice-icon" style="width:${playlistImageSize}px;height:${playlistImageSize}px;">
                <ha-icon icon="${this._escape(icon)}"></ha-icon>
                <span class="choice-playing"><ha-icon icon="mdi:music-note"></ha-icon></span>
               </span>
               <span class="choice-name">${this._escape(name)}</span>`
          }
        </button>
      `;
    };

    const playlistChoices = availablePlaylists
      .map((pl, i) => renderPlaylistTile(pl, i, "music-assistant"))
      .join("");
    const spotifyPlaylistChoices = [
      ...availableSpotifyPlaylists.map((pl, i) => renderPlaylistTile(pl, i, "spotify")),
      ...spotifyBooleans.map((b, i) => renderPlaylistTile(b, i, "boolean")),
    ].join("");

    // ── Controls markup ───────────────────────────────────────────────────────
    const controlsMarkup = showShuffleRepeat
      ? `
        <div class="controls has-shuffle-repeat">
          <button class="control shuffle ${shuffleOn ? "active" : ""}" aria-label="Shuffle">
            <ha-icon icon="${shuffleIcon}"></ha-icon>
          </button>
          <button class="control previous" aria-label="Forrige"><ha-icon icon="mdi:skip-previous"></ha-icon></button>
          <button class="control play" aria-label="Spill av eller pause"><ha-icon icon="${playing ? "mdi:pause" : "mdi:play"}"></ha-icon></button>
          <button class="control next" aria-label="Neste"><ha-icon icon="mdi:skip-next"></ha-icon></button>
          <button class="control repeat ${repeatMode !== "off" ? "active" : ""}" aria-label="Repeat">
            <ha-icon icon="${repeatIcon}"></ha-icon>
          </button>
        </div>
      `
      : `
        <div class="controls">
          <button class="control previous" aria-label="Forrige"><ha-icon icon="mdi:skip-previous"></ha-icon></button>
          <button class="control play" aria-label="Spill av eller pause"><ha-icon icon="${playing ? "mdi:pause" : "mdi:play"}"></ha-icon></button>
          <button class="control next" aria-label="Neste"><ha-icon icon="mdi:skip-next"></ha-icon></button>
        </div>
      `;

    const volumeMarkup = showVolume
      ? `
        <div class="volume">
          <button class="volume-button" aria-label="${data.muted ? "Unmute" : "Mute"}">
            <ha-icon icon="${volumeIcon}"></ha-icon>
          </button>
          <input class="volume-slider" type="range" min="0" max="100" value="${volumePct}" />
        </div>
      `
      : "";

    const coverArtMarkup = showCoverArt
      ? `
        <div class="cover-art">
          <img src="${this._escape(data.coverArt)}" alt="" style="max-height:${coverArtSize}px;">
        </div>
      `
      : "";

    const progressMarkup = showProgressBar
      ? `
        <div class="progress-bar-wrap">
          <input class="progress-slider" type="range" min="0" max="${Math.round(data.mediaDuration)}"
            value="${Math.round(data.mediaPosition)}" aria-label="Seek">
          <div class="progress-time">
            <span class="progress-elapsed"></span>
            <span class="progress-remaining"></span>
          </div>
        </div>
      `
      : "";

    // Task 4: preserve playlist scroll position across re-renders
    const savedScrollTop = (this._panel === "playlists" || this._panel === "spotify-playlists")
      ? (this.shadowRoot.querySelector(".choices")?.scrollTop || 0)
      : 0;

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
          --nmp-shuffle-active-color: ${this.config.shuffle_active_color || "#A8C49A"};
          --nmp-repeat-active-color: ${this.config.repeat_active_color || "#A8C49A"};
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
          padding: 18px 76px 8px 76px;
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
          cursor: pointer;
          border: 0;
          padding: 0;
          -webkit-user-select: none;
          user-select: none;
        }

        .source ha-icon {
          width: 23px;
          height: 23px;
        }

        .playlist-btn {
          position: absolute;
          right: 18px;
          top: 18px;
          width: 43px;
          height: 43px;
          border-radius: 50%;
          color: var(--nmp-text);
          background: var(--nmp-icon-background);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border: 0;
          padding: 0;
          -webkit-user-select: none;
          user-select: none;
        }

        .playlist-btn ha-icon {
          width: 23px;
          height: 23px;
        }

        .source.active {
          background: var(--nmp-active-background);
          border: 1px solid var(--nmp-active-border);
        }

        .playlist-btn.active {
          background: var(--nmp-active-background);
          border: 1px solid var(--nmp-active-border);
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
          0%, 15% { transform: translateX(0); }
          45%, 65% { transform: translateX(calc(-1 * var(--nmp-title-distance, 0px))); }
          95%, 100% { transform: translateX(0); }
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

        .cover-art {
          height: ${coverArtContainerHeight || coverArtSize + 12}px;
          padding: 6px 18px 6px;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .cover-art img {
          width: auto;
          height: auto;
          max-width: 100%;
          max-height: ${coverArtSize}px;
          display: block;
          object-fit: contain;
          border-radius: 12px;
        }

        .cover-left-layout {
          min-height: ${showVolume ? "170px" : "128px"};
          padding: 8px 18px 16px;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: minmax(112px, 40%) minmax(0, 1fr);
          gap: 18px;
          align-items: center;
        }

        .cover-left-layout .cover-art {
          height: auto;
          padding: 0;
          justify-content: flex-start;
        }

        .cover-left-layout .cover-art img {
          width: 100%;
          max-width: 150px;
          max-height: ${showVolume ? "142px" : "110px"};
          aspect-ratio: 1;
          margin-bottom: 8px;
          object-fit: cover;
        }

        .cover-left-actions {
          display: grid;
          gap: 12px;
          min-width: 0;
        }

        .cover-left-actions .controls {
          height: 66px;
          grid-template-columns: 36px 54px 36px;
          column-gap: 14px;
          justify-content: center;
        }

        .cover-left-actions .control { width: 36px; height: 36px; }
        .cover-left-actions .play { width: 54px; height: 54px; }
        .cover-left-actions .shuffle,
        .cover-left-actions .repeat { position: static; transform: none; }

        .cover-left-actions .controls.has-shuffle-repeat {
          grid-template-columns: 34px 34px 52px 34px 34px;
          column-gap: 8px;
        }

        .cover-left-actions .volume { height: 40px; padding: 0; }

        @media (max-width: 380px) {
          .cover-left-layout {
            grid-template-columns: minmax(88px, 36%) minmax(0, 1fr);
            gap: 12px;
            padding-left: 14px;
            padding-right: 14px;
          }
          .cover-left-actions .controls {
            grid-template-columns: 32px 48px 32px;
            column-gap: 8px;
          }
          .cover-left-actions .controls.has-shuffle-repeat {
            grid-template-columns: 30px 30px 46px 30px 30px;
            column-gap: 4px;
          }
        }

        .controls {
          height: 66px;
          position: relative;
          margin-top: -4px;
          display: grid;
          grid-template-columns: 40px 56px 40px;
          align-items: center;
          justify-content: center;
          column-gap: 24px;
        }

        .controls.has-shuffle-repeat {
          grid-template-columns: 38px 40px 56px 40px 38px;
          column-gap: 16px;
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

        .control ha-icon { width: 23px; height: 23px; }

        .shuffle { grid-column: 1; }
        .previous { grid-column: 2; }
        .controls:not(.has-shuffle-repeat) .previous { grid-column: 1; }
        .controls:not(.has-shuffle-repeat) .play { grid-column: 2; }
        .controls:not(.has-shuffle-repeat) .next { grid-column: 3; }
        .play { grid-column: 3; }
        .next { grid-column: 4; }
        .repeat { grid-column: 5; }

        .shuffle.active { color: var(--nmp-shuffle-active-color); background: transparent; }
        .repeat.active { color: var(--nmp-repeat-active-color); background: transparent; }

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
          padding: 6px 18px 8px;
          margin-top: 0;
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

        .volume-button {
          width: 28px;
          height: 28px;
          border: 0;
          padding: 0;
          border-radius: 50%;
          color: var(--nmp-text);
          background: transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .volume-button ha-icon { width: 20px; height: 20px; }

        input[type="range"] {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          accent-color: var(--nmp-accent);
        }

        /* ── Choices grid ─────────────────────────────────────────────────── */
        .choices {
          height: ${choicesHeight}px;
          padding: 12px 8px 0;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: repeat(${choiceColumns}, 1fr);
          grid-auto-rows: ${choiceRowHeight}px;
          gap: 6px;
        }

        .playlist-panel-title {
          height: ${playlistTitleHeight}px;
          padding: 2px 76px 0;
          box-sizing: border-box;
          color: var(--nmp-text);
          font-size: 13px;
          font-weight: 800;
          line-height: 18px;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .playlist-panel .choices { padding-top: 6px; }

        /* ── Choice button ────────────────────────────────────────────────── */
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

        .choice-icon ha-icon { width: 25px; height: 25px; }

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
          line-height: 0;
          color: var(--nmp-active-text);
          background: var(--nmp-accent);
          box-shadow: 0 0 10px rgba(168,196,154,0.28);
          pointer-events: none;
        }

        .choice-playing ha-icon {
          width: 12px;
          height: 12px;
          display: block;
          --mdc-icon-size: 12px;
        }

        .choice.active .choice-playing { display: flex; }

        .choice.has-image .choice-playing {
          right: 5px;
          top: 5px;
        }

        .choice.playlist-choice.has-image.active .choice-image {
          box-shadow: 0 0 0 2px var(--nmp-accent), 0 4px 14px rgba(0,0,0,0.28);
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

        .playlist-choice .choice-name {
          max-width: 82px;
          min-height: 26px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          white-space: normal;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ── Image playlist tiles ─────────────────────────────────────────── */
        .choice.has-image { padding: 0; gap: 0; }

        .choice-image {
          display: block;
          border-radius: 10px;
          background-image: var(--pl-image);
          background-size: cover;
          background-position: center;
          position: relative;
          overflow: hidden;
          box-shadow: 0 4px 14px rgba(0,0,0,0.28);
          flex-shrink: 0;
        }

        .choice-name-over {
          position: absolute;
          bottom: 0; left: 0; right: 0;
          padding: 18px 6px 5px;
          background: linear-gradient(transparent, rgba(0,0,0,0.62));
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          text-align: center;
          min-height: unset;
          display: block;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100%;
          -webkit-line-clamp: unset;
          -webkit-box-orient: unset;
        }

        .progress-bar-wrap {
          padding: 0 26px;
          box-sizing: border-box;
          margin-top: 4px;
        }

        .progress-slider {
          width: 100%;
          height: 4px;
          -webkit-appearance: none;
          appearance: none;
          border-radius: 2px;
          background: linear-gradient(to right,
            ${this.config.progress_color || colors.text || "#EAD8B5"} var(--nmp-progress-pct, 0%),
            rgba(234,216,181,0.22) var(--nmp-progress-pct, 0%));
          outline: none;
          cursor: pointer;
          accent-color: ${this.config.progress_color || colors.text || "#EAD8B5"};
        }

        .progress-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px; height: 12px;
          border-radius: 50%;
          background: ${this.config.progress_color || colors.text || "#EAD8B5"};
          cursor: pointer;
          box-shadow: 0 0 4px rgba(0,0,0,0.3);
        }

        .progress-slider::-moz-range-thumb {
          width: 12px; height: 12px;
          border-radius: 50%;
          background: ${this.config.progress_color || colors.text || "#EAD8B5"};
          border: none;
          cursor: pointer;
        }

        .progress-time {
          display: flex;
          justify-content: space-between;
          padding-top: 3px;
          font-size: 10px;
          color: var(--nmp-muted);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }

        /* ── Fix #5: per-player volume rows ───────────────────────────────── */
        .player-volumes {
          padding: 2px 14px 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          box-sizing: border-box;
        }

        .pvol-row {
          display: grid;
          grid-template-columns: 20px minmax(0, 1fr) minmax(60px, 1.4fr) 30px;
          align-items: center;
          gap: 8px;
          height: ${pvRowH}px;
          padding: 0 4px;
          box-sizing: border-box;
        }

        .pvol-disabled {
          opacity: 0.36;
          pointer-events: none;
        }

        .pvol-icon {
          width: 18px;
          height: 18px;
          color: var(--nmp-muted);
          flex-shrink: 0;
          --mdc-icon-size: 18px;
        }

        .pvol-name {
          font-size: 11px;
          font-weight: 700;
          color: var(--nmp-text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }

        .pvol-slider {
          width: 100%;
          min-width: 0;
          accent-color: var(--nmp-accent);
        }

        .pvol-mute {
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          border: 0;
          padding: 0;
          border-radius: 50%;
          background: transparent;
          color: var(--nmp-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .pvol-mute ha-icon {
          width: 18px;
          height: 18px;
          --mdc-icon-size: 18px;
        }

        .pvol-mute.muted {
          color: var(--nmp-text);
        }

        /* ── Task 3: speaker extras — pill buttons ────────────────────── */
        .speaker-extras {
          padding: 4px 14px 6px;
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          box-sizing: border-box;
        }

        .speaker-extra-btn {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 7px;
          padding: 6px 14px 6px 10px;
          border: 0;
          border-radius: 22px;
          background: var(--nmp-choice-background);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 10px rgba(0,0,0,0.14);
          color: var(--nmp-muted);
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          font-weight: 700;
          -webkit-user-select: none;
          user-select: none;
          transition: background 0.15s;
          min-width: 64px;
        }

        .speaker-extra-btn.on {
          background: var(--nmp-active-background);
          border: 1px solid var(--nmp-active-border);
          color: var(--nmp-accent);
          box-shadow: var(--nmp-active-glow);
        }

        .speaker-extra-icon-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          flex-shrink: 0;
        }

        .speaker-extra-icon-wrap ha-icon {
          width: 18px;
          height: 18px;
          --mdc-icon-size: 18px;
        }

        .speaker-extra-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 90px;
          color: inherit;
        }

        /* ── Task 4: row layout — choice-row-name (title beside image) ── */
        .choice-row-name {
          display: none;
        }

        .choices.row-layout .choice-row-name {
          display: block;
          flex: 1;
          text-align: left;
          font-size: 13px;
          font-weight: 600;
          color: var(--nmp-text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        /* ── Task 4: vertical row list layout ──────────────────────────── */
        .choices.row-layout {
          display: flex !important;
          flex-direction: column;
          overflow-y: auto;
          max-height: ${rowChoicesH}px;
          height: auto !important;
          padding: 4px 8px 8px;
          gap: 4px;
          box-sizing: border-box;
          scrollbar-width: thin;
          scrollbar-color: var(--nmp-muted) transparent;
        }

        .choices.row-layout .choice {
          flex-shrink: 0;
          width: 100%;
          flex-direction: row;
          align-items: center;
          gap: 10px;
          padding: 5px 8px;
          border-radius: 8px;
          min-height: ${rowItemH}px;
          justify-content: flex-start;
        }

        .choices.row-layout .choice.active {
          background: var(--nmp-active-background);
          border: 1px solid var(--nmp-active-border);
        }

        .choices.row-layout .choice-icon {
          width: ${rowThumbSize}px;
          height: ${rowThumbSize}px;
          flex-shrink: 0;
          border-radius: 8px;
        }

        .choices.row-layout .choice-image {
          width: ${rowThumbSize}px;
          height: ${rowThumbSize}px;
          flex-shrink: 0;
          border-radius: 8px;
        }

        .choices.row-layout .choice-name {
          flex: 1;
          text-align: left;
          max-width: unset;
          font-size: 13px;
          font-weight: 600;
          min-height: unset;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          -webkit-line-clamp: unset;
          -webkit-box-orient: unset;
          display: block;
        }

        .choices.row-layout .choice-name-over {
          display: none;
        }

        .choices.row-layout .choice-playing {
          position: static;
          flex-shrink: 0;
          width: 19px;
          height: 19px;
        }
      </style>

      <ha-card>
        <div class="header">
          <button class="source${this._panel === 'players' ? ' active' : ''}" aria-label="Velg mediaspiller"><ha-icon icon="${data.icon}"></ha-icon></button>
          ${showPlaylistBtn
            ? `<button class="playlist-btn${playlistPanelActive ? " active" : ""}" aria-label="Spillelister">
                 <ha-icon icon="mdi:playlist-music"></ha-icon>
               </button>`
            : `<button class="menu" aria-label="Meny"><ha-icon icon="mdi:dots-horizontal"></ha-icon></button>`
          }
          <div class="title${titleIsLong ? " scrolling" : ""}"><span>${this._escape(data.title)}</span></div>
          <div class="artist">${this._escape(data.artist)}</div>
        </div>

        ${
          this._panel === "players"
            ? `<div class="choices">${choices}</div>${speakerExtrasAboveMarkup}${playerVolumesMarkup}${speakerExtrasBelowMarkup}`
            : this._panel === "playlists"
              ? `
                <div class="playlist-panel">
                  <div class="playlist-panel-title">Music Assistant</div>
                  <div class="choices${isRowLayout ? " row-layout" : ""}">${playlistChoices}</div>
                </div>
              `
            : this._panel === "spotify-playlists"
              ? `
                <div class="playlist-panel">
                  <div class="playlist-panel-title">Spotify Playlists</div>
                  <div class="choices${isRowLayout ? " row-layout" : ""}">${spotifyPlaylistChoices}</div>
                </div>
              `
            : `
              ${
                coverArtLeft
                  ? `
                    <div class="cover-left-layout">
                      ${coverArtMarkup}
                      <div class="cover-left-actions">
                        ${controlsMarkup}
                        ${volumeMarkup}
                      </div>
                    </div>
                  `
                  : `
                    ${coverArtMarkup}
                    ${progressMarkup}
                    ${controlsMarkup}
                    ${volumeMarkup}
                  `
              }
            `
        }
      </ha-card>
    `;

    // ── Source button: tap toggles players panel ──────────────────────────
    const sourceBtn = this.shadowRoot.querySelector(".source");
    sourceBtn?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._panel = this._panel === "players" ? "controls" : "players";
      this._render();
    });

    // ── Playlist btn: cycle MA → Spotify Playlists → controls ────────────
    this.shadowRoot.querySelector(".playlist-btn")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._panel = this._getNextPlaylistPanel(availablePlaylists, availableSpotifyPlaylists, spotifyBooleans);
      this._render();
    });

    // ── 3-dots fallback ───────────────────────────────────────────────────
    this.shadowRoot.querySelector(".menu")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._panel = this._panel === "players" ? "controls" : "players";
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

    this.shadowRoot.querySelector(".shuffle")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._toggleShuffle(data);
    });

    this.shadowRoot.querySelector(".repeat")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._cycleRepeat(data);
    });

    this.shadowRoot.querySelector(".volume-slider")?.addEventListener("change", (ev) => {
      ev.stopPropagation();
      this._setVolume(Number(ev.target.value) / 100);
    });

    this.shadowRoot.querySelector(".volume-button")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._toggleMute(data.muted);
    });

    // ── Progress bar: RAF animation + scrubbing ───────────────────────────
    const progressSlider = this.shadowRoot.querySelector(".progress-slider");
    if (progressSlider) {
      const progressColor = this.config.progress_color || "#EAD8B5";
      const duration = data.mediaDuration;

      let startPosition = data.mediaPosition;
      const rawUpdatedAt = data.mediaPositionUpdatedAt;
      if (playing && startPosition === 0 && duration > 0 && this._lastKnownPosition > 0) {
        const lastAtMs = this._lastKnownMediaPositionUpdatedAt
          ? new Date(this._lastKnownMediaPositionUpdatedAt).getTime()
          : 0;
        const newAtMs = rawUpdatedAt ? new Date(rawUpdatedAt).getTime() : 0;
        if (newAtMs <= lastAtMs) {
          startPosition = this._lastKnownPosition;
        }
      }
      if (startPosition > 0) {
        this._lastKnownPosition = startPosition;
        this._lastKnownMediaPositionUpdatedAt = rawUpdatedAt;
      }

      const startTime = rawUpdatedAt ? new Date(rawUpdatedAt).getTime() : Date.now();
      let rafId;

      const tick = () => {
        if (!this.shadowRoot) return;
        const elapsed = playing ? (Date.now() - startTime) / 1000 : 0;
        const pos = Math.min(duration, startPosition + elapsed);
        const pct = duration > 0 ? (pos / duration) * 100 : 0;
        progressSlider.value = Math.round(pos);
        progressSlider.style.background = `linear-gradient(to right, ${progressColor} ${pct}%, rgba(234,216,181,0.22) ${pct}%)`;
        const elapsedEl = this.shadowRoot.querySelector(".progress-elapsed");
        const remainingEl = this.shadowRoot.querySelector(".progress-remaining");
        if (elapsedEl) elapsedEl.textContent = this._formatTime(pos);
        if (remainingEl) remainingEl.textContent = `-${this._formatTime(duration - pos)}`;
        if (playing) rafId = requestAnimationFrame(tick);
      };
      tick();
      this._cancelProgressRaf = () => cancelAnimationFrame(rafId);

      progressSlider.addEventListener("change", (ev) => {
        ev.stopPropagation();
        const seekTo = Number(ev.target.value);
        const entityId = this._getActiveEntityId();
        const spotifyEntityId = this.config.spotify_entity || this.config.spotify_player_entity;
        const activeCfg = this._getConfiguredPlayer(entityId);
        const hasSpotifySource = Boolean(activeCfg.spotify_source_name || activeCfg.source_name);
        const isSpotifyEntity = entityId === spotifyEntityId;

        if (spotifyEntityId && (isSpotifyEntity || hasSpotifySource)) {
          this._hass.callService("spotifyplus", "player_media_seek", {
            entity_id: spotifyEntityId,
            position_ms: Math.round(seekTo * 1000),
          });
        } else if (entityId) {
          this._hass.callService("media_player", "media_seek", { seek_position: seekTo }, { entity_id: entityId });
        }
      });
    }

    // ── Playlist choices ──────────────────────────────────────────────────
    this.shadowRoot.querySelectorAll(".playlist-choice").forEach((button) => {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const type = ev.currentTarget.dataset.playlistType || "music-assistant";
        const idx = Number(ev.currentTarget.dataset.playlistIndex);
        const collection = type === "spotify"
          ? availableSpotifyPlaylists
          : type === "boolean"
            ? spotifyBooleans
            : availablePlaylists;
        this._selectPlaylist(collection[idx], type);
      });
    });

    // ── Player choices: tap = select, hold (~600ms) = cast ────────────────
    this.shadowRoot.querySelectorAll(".choice:not(.playlist-choice)").forEach((button) => {
      let holdTimer = null;
      let didHold = false;

      button.addEventListener("pointerdown", () => {
        didHold = false;
        holdTimer = setTimeout(() => {
          didHold = true;
          const entity = button.dataset.player;
          const player = this.config.players.find((item) => item.entity === entity);
          if (player) this._castToPlayer(player);
        }, 600);
      });

      button.addEventListener("pointerup", () => clearTimeout(holdTimer));
      button.addEventListener("pointerleave", () => clearTimeout(holdTimer));

      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (didHold) return;
        const entity = button.dataset.player;
        const player = this.config.players.find((item) => item.entity === entity);
        if (player) this._selectPlayer(player);
      });
    });

    // ── Fix #5: per-player volume sliders and mute buttons ────────────────
    this.shadowRoot.querySelectorAll(".pvol-slider").forEach((slider) => {
      slider.addEventListener("change", (ev) => {
        ev.stopPropagation();
        const entityId = ev.currentTarget.closest(".pvol-row")?.dataset.entity;
        if (entityId) {
          const playerCfg = this._getConfiguredPlayer(entityId);
          if (playerCfg.local_volume) {
            this._localVolumes[entityId] = Number(ev.target.value) / 100;
          }
          this._hass.callService(
            "media_player",
            "volume_set",
            { volume_level: Number(ev.target.value) / 100 },
            { entity_id: entityId },
          );
        }
      });
    });

    this.shadowRoot.querySelectorAll(".pvol-mute").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const entityId = ev.currentTarget.dataset.entity;
        if (entityId) {
          const pState = this._hass?.states?.[entityId];
          const currentMuted = Boolean(pState?.attributes?.is_volume_muted);
          this._hass.callService(
            "media_player",
            "volume_mute",
            { is_volume_muted: !currentMuted },
            { entity_id: entityId },
          );
        }
      });
    });

    // ── Task 3: speaker extras toggle ─────────────────────────────────────────
    this.shadowRoot.querySelectorAll(".speaker-extra-btn").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const entityId = ev.currentTarget.dataset.entity;
        if (!entityId) return;
        const domain = entityId.split(".")[0];
        const state = this._hass?.states?.[entityId]?.state;
        const service = state === "on" ? "turn_off" : "turn_on";
        this._hass.callService(domain, service, {}, { entity_id: entityId });
      });
    });

    // ── Title marquee ─────────────────────────────────────────────────────
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

    // Task 4: restore playlist scroll position without jump
    if (savedScrollTop > 0) {
      requestAnimationFrame(() => {
        const choicesEl = this.shadowRoot.querySelector(".choices");
        if (choicesEl) choicesEl.scrollTop = savedScrollTop;
      });
    }
  }

  _formatTime(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }
}

customElements.define("nature-media-player-card-dev", NatureMediaPlayerCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "nature-media-player-card-dev",
  name: "Nature Media Player Card (Dev)",
  description: "Nature-inspired dynamic media player card (dev build)",
});

// ─────────────────────────────────────────────────────────────────────────────
// Visual Editor
// ─────────────────────────────────────────────────────────────────────────────

class NatureMediaPlayerCardEditor extends HTMLElement {
  constructor() {
    super();
    this._maPlaylistOptions = [];
    this._maPlaylistLoading = false;
    this._maPlaylistError = "";
    this._maConfigEntries = [];
    this._maConfigEntriesLoaded = false;
    this._maConfigEntriesLoading = false;
    this._playersOpen = true;
    this._playlistsOpen = false;
    this._spotifyPlaylistsOpen = false;
    this._optionsOpen = false;
    this._colorsOpen = false;
    this._speakerExtrasOpen = false;
    this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    if (this.config) this._loadMusicAssistantConfigEntries();
    if (this.config && !this._renderedWithHass) this._render();
  }

  setConfig(config) {
    this.config = {
      players: [],
      playlists: [],
      spotify_playlists: [],
      spotify_booleans: [],
      speaker_extras: [],
      colors: {},
      show_volume: true,
      show_cover_art: false,
      cover_art_layout: "center",
      cover_art_size: 160,
      show_shuffle_repeat: false,
      show_progress: true,
      idle_timeout_minutes: 0,
      pause_timeout_minutes: 0,
      show_playlist_images: true,
      playlist_display: "grid",
      playlist_columns: 4,
      playlist_image_size: 100,
      cover_art_attribute: "entity_picture",
      spotify_entity: "",
      shuffle_active_color: "",
      repeat_active_color: "",
      disable_collapse: false,
      ...config,
    };
    this._render();
  }

  _orderedConfig(config) {
    const { type, players, playlists, spotify_playlists, colors, ...rest } = config;
    const ordered = {
      type: type || "custom:nature-media-player-card-dev",
      players: Array.isArray(players) ? players : [],
    };

    if (Array.isArray(playlists) && playlists.length) {
      ordered.playlists = playlists;
    }

    if (Array.isArray(spotify_playlists) && spotify_playlists.length) {
      ordered.spotify_playlists = spotify_playlists;
    }

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
    this._playersOpen = true;
    const players = [...(this.config.players || [])];
    players[index] = { ...(players[index] || {}) };

    if (value === "" || value === null || value === undefined) {
      delete players[index][key];
    } else {
      players[index][key] = value;
    }

    this._fireConfigChanged({ ...this.config, players });
  }

  _setPlaylist(index, key, value) {
    const playlists = [...(this.config.playlists || [])];
    playlists[index] = { ...(playlists[index] || {}) };

    if (value === "" || value === null || value === undefined) {
      delete playlists[index][key];
    } else {
      playlists[index][key] = value;
    }

    this._fireConfigChanged({ ...this.config, playlists });
  }

  _setSpotifyPlaylist(index, key, value) {
    this._spotifyPlaylistsOpen = true;
    const spotify_playlists = [...(this.config.spotify_playlists || [])];
    spotify_playlists[index] = { ...(spotify_playlists[index] || {}) };

    if (value === "" || value === null || value === undefined) {
      delete spotify_playlists[index][key];
    } else {
      spotify_playlists[index][key] = value;
    }

    this._fireConfigChanged({ ...this.config, spotify_playlists });
  }

  _addPlayer() {
    this._playersOpen = true;
    const players = [...(this.config.players || [])];
    players.push({
      entity: this._defaultPlayerEntity(),
      name: "",
      icon: "mdi:speaker",
      spotify_source_name: "",
      show_playlists: false,
    });
    this._fireConfigChanged({ ...this.config, players });
  }

  _addPlaylist() {
    this._playlistsOpen = true;
    const playlists = [...(this.config.playlists || [])];
    const option = this._maPlaylistOptions[0] || {};
    playlists.push({
      media_id: option.media_id || "",
      title: option.name || "",
      name: "",
      icon: "mdi:playlist-music",
    });
    this._fireConfigChanged({ ...this.config, playlists });
  }

  _addSpotifyBoolean() {
    this._spotifyPlaylistsOpen = true;
    const spotify_booleans = [...(this.config.spotify_booleans || [])];
    spotify_booleans.push({ entity: "", name: "", icon: "mdi:toggle-switch-outline" });
    this._fireConfigChanged({ ...this.config, spotify_booleans });
  }

  _removeSpotifyBoolean(index) {
    this._spotifyPlaylistsOpen = true;
    const spotify_booleans = [...(this.config.spotify_booleans || [])];
    spotify_booleans.splice(index, 1);
    this._fireConfigChanged({ ...this.config, spotify_booleans });
  }

  _setSpotifyBoolean(index, key, value) {
    this._spotifyPlaylistsOpen = true;
    const spotify_booleans = [...(this.config.spotify_booleans || [])];
    spotify_booleans[index] = { ...(spotify_booleans[index] || {}) };
    if (value === "" || value === null || value === undefined) {
      delete spotify_booleans[index][key];
    } else {
      spotify_booleans[index][key] = value;
    }
    this._fireConfigChanged({ ...this.config, spotify_booleans });
  }

  _addSpeakerExtra() {
    this._speakerExtrasOpen = true;
    const speaker_extras = [...(this.config.speaker_extras || [])];
    speaker_extras.push({ entity: "", name: "", icon: "", position: "below" });
    this._fireConfigChanged({ ...this.config, speaker_extras });
  }

  _removeSpeakerExtra(index) {
    this._speakerExtrasOpen = true;
    const speaker_extras = [...(this.config.speaker_extras || [])];
    speaker_extras.splice(index, 1);
    this._fireConfigChanged({ ...this.config, speaker_extras });
  }

  _setSpeakerExtra(index, key, value) {
    this._speakerExtrasOpen = true;
    const speaker_extras = [...(this.config.speaker_extras || [])];
    speaker_extras[index] = { ...(speaker_extras[index] || {}) };
    if (value === "" || value === null || value === undefined) {
      delete speaker_extras[index][key];
    } else {
      speaker_extras[index][key] = value;
    }
    this._fireConfigChanged({ ...this.config, speaker_extras });
  }

  _addSpotifyPlaylist() {
    this._spotifyPlaylistsOpen = true;
    const spotify_playlists = [...(this.config.spotify_playlists || [])];
    spotify_playlists.push({
      playlist_url: "",
      name: "",
      icon: "mdi:spotify",
    });
    this._fireConfigChanged({ ...this.config, spotify_playlists });
  }

  _removePlayer(index) {
    this._playersOpen = true;
    const players = [...(this.config.players || [])];
    players.splice(index, 1);
    this._fireConfigChanged({ ...this.config, players });
  }

  _removePlaylist(index) {
    const playlists = [...(this.config.playlists || [])];
    playlists.splice(index, 1);
    this._fireConfigChanged({ ...this.config, playlists });
  }

  _removeSpotifyPlaylist(index) {
    this._spotifyPlaylistsOpen = true;
    const spotify_playlists = [...(this.config.spotify_playlists || [])];
    spotify_playlists.splice(index, 1);
    this._fireConfigChanged({ ...this.config, spotify_playlists });
  }

  _input(label, value, placeholder) {
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

  _select(label, value, options) {
    return `
      <label>
        <span>${label}</span>
        <select>
          ${options
            .map(
              (option) => `
                <option value="${this._escape(option.value)}" ${option.value === value ? "selected" : ""}>
                  ${this._escape(option.label)}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>
    `;
  }

  _entityPicker(label, value, index, domainFilter = ["media_player."]) {
    const entities = Object.keys(this._hass?.states || {})
      .filter((entityId) => domainFilter.some((d) => entityId.startsWith(d)))
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
            placeholder="Search entity"
            autocomplete="off"
          >
          <div class="entity-options">
            ${entities
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

  _numberInput(label, value, min = 0, max = 9999, step = 1) {
    return `
      <label>
        <span>${label}</span>
        <input type="number" class="number-input" min="${min}" max="${max}" step="${step}" value="${Number(value) || ""}">
      </label>
    `;
  }

  _colorInput(label, value, placeholder) {
    const presets = [
      { label: "Mint", value: "#A8C49A" },
      { label: "Sage", value: "#8FAF82" },
      { label: "Cream", value: "#EAD8B5" },
      { label: "White", value: "#F4F7F1" },
      { label: "Forest", value: "#1E3A2F" },
      { label: "Dark green", value: "rgba(60,94,74,0.72)" },
      { label: "Transparent", value: "transparent" },
    ];
    const displayVal = this._escape(value || "");
    const swatchVal = /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : "#A8C49A";
    return `
      <label class="color-field">
        <span>${label}</span>
        <div class="color-input-row">
          <input type="color" class="color-swatch" value="${this._escape(swatchVal)}" title="Pick color">
          <input type="text" class="color-text" value="${displayVal}" placeholder="${this._escape(placeholder || "e.g. #A8C49A or rgba(...)")}">
          <select class="color-preset">
            <option value="">Presets…</option>
            ${presets.map(p =>
              `<option value="${this._escape(p.value)}" ${p.value === value ? "selected" : ""}>${this._escape(p.label)}</option>`
            ).join("")}
          </select>
        </div>
      </label>
    `;
  }

  async _loadMusicAssistantConfigEntries() {
    if (!this._hass?.callWS || this._maConfigEntriesLoaded || this._maConfigEntriesLoading) return;

    this._maConfigEntriesLoading = true;
    try {
      let response;
      let domainFiltered = false;
      try {
        response = await this._hass.callWS({ type: "config_entries/get", domain: "music_assistant" });
        domainFiltered = true;
      } catch (_err) {
        response = await this._hass.callWS({ type: "config_entries/get" });
      }

      const entries = Array.isArray(response) ? response : response?.entries || [];
      this._maConfigEntries = entries
        .filter((entry) => domainFiltered || entry?.domain === "music_assistant")
        .map((entry) => ({
          id: entry.entry_id || entry.id,
          title: entry.title || entry.name || entry.entry_id || entry.id,
        }))
        .filter((entry) => entry.id);
    } catch (_err) {
      this._maConfigEntries = [];
    } finally {
      this._maConfigEntriesLoaded = true;
      this._maConfigEntriesLoading = false;
      this._render();
    }
  }

  _musicAssistantConfigEntryPicker() {
    if (!this._maConfigEntries.length) {
      return `
        <label>
          <span>Music Assistant config entry ID</span>
          <input
            class="ma-config-entry"
            value="${this._escape(this.config.music_assistant_config_entry_id || "")}"
            placeholder="${this._maConfigEntriesLoading ? "Loading Music Assistant entries" : ""}"
          >
        </label>
      `;
    }

    const current = this.config.music_assistant_config_entry_id || "";
    return `
      <label>
        <span>Music Assistant config entry ID</span>
        <select class="ma-config-entry">
          <option value="">Choose Music Assistant entry</option>
          ${this._maConfigEntries
            .map(
              (entry) => `
                <option value="${this._escape(entry.id)}" ${entry.id === current ? "selected" : ""}>
                  ${this._escape(entry.title)}
                </option>
              `,
            )
            .join("")}
        </select>
      </label>
    `;
  }

  async _loadMusicAssistantPlaylists() {
    const configEntryId = this.config.music_assistant_config_entry_id;
    if (!configEntryId || !this._hass || this._maPlaylistLoading) return;

    this._playlistsOpen = true;
    this._maPlaylistLoading = true;
    this._maPlaylistError = "";
    this._render();

    try {
      const data = {
        config_entry_id: configEntryId,
        media_type: "playlist",
        limit: Number(this.config.music_assistant_playlist_limit || 50),
      };
      let response = await this._hass.callService(
        "music_assistant",
        "get_library",
        data,
        undefined,
        true,
        true,
      );
      if (!response && this._hass.callWS) {
        response = await this._hass.callWS({
          type: "execute_script",
          sequence: [
            {
              service: "music_assistant.get_library",
              data,
              response_variable: "ma_playlists",
            },
          ],
          return_response: true,
        });
      }
      const items = this._extractMusicAssistantItems(response);
      this._maPlaylistOptions = items.map((item) => this._mapMusicAssistantPlaylist(item)).filter((item) => item.media_id);
      if (!this._maPlaylistOptions.length) {
        this._maPlaylistError = "No playlists returned from Music Assistant.";
      }
    } catch (err) {
      this._maPlaylistOptions = [];
      this._maPlaylistError = err?.message || "Could not load Music Assistant playlists.";
    } finally {
      this._maPlaylistLoading = false;
      this._render();
    }
  }

  _extractMusicAssistantItems(response) {
    const candidates = [
      response?.items,
      response?.playlists,
      response?.playlist,
      response?.response?.items,
      response?.response?.playlists,
      response?.response?.ma_playlists?.items,
      response?.response?.ma_playlists?.playlists,
      response?.service_response?.items,
      response?.result?.items,
      response,
    ];
    const found = candidates.find((item) => Array.isArray(item));
    return found || [];
  }

  _mapMusicAssistantPlaylist(item) {
    const mediaId = item?.uri || item?.media_id || item?.item_id || item?.id || item?.name || item?.title || "";
    const name = item?.name || item?.title || item?.media_title || mediaId;
    return {
      media_id: String(mediaId),
      name: String(name),
    };
  }

  _setPlaylistFromOption(index, mediaId) {
    const option = this._maPlaylistOptions.find((item) => item.media_id === mediaId) || {};
    const playlists = [...(this.config.playlists || [])];
    playlists[index] = {
      ...(playlists[index] || {}),
      media_id: mediaId,
      title: option.name || playlists[index]?.title || "",
      name: playlists[index]?.name || "",
    };
    delete playlists[index].source;
    this._fireConfigChanged({ ...this.config, playlists });
  }

  _playlistSelect(label, value, options) {
    return `
      <label>
        <span>${label}</span>
        <select class="playlist-source">
          <option value="">Choose playlist</option>
          ${options
            .map(
              (option) => `
                <option value="${this._escape(option.media_id)}" ${option.media_id === value ? "selected" : ""}>
                  ${this._escape(option.name)}
                </option>
              `,
            )
            .join("")}
        </select>
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
    const playlists = this.config.playlists || [];
    const spotifyPlaylists = this.config.spotify_playlists || [];
    const spotifyBooleans = this.config.spotify_booleans || [];
    const speakerExtras = this.config.speaker_extras || [];
    const playlistOptions = this._maPlaylistOptions || [];
    const colors = this.config.colors || {};
    const colorFields = [
      ["surface", "Surface", "rgba(60,94,74,0.72)"],
      ["border", "Border", "rgba(168,196,154,0.13)"],
      ["accent", "Accent", "#A8C49A"],
      ["light", "Light", "#E9F1E8"],
      ["text", "Text", "#EAD8B5"],
      ["muted", "Muted text", "rgba(234,216,181,0.72)"],
      ["icon_background", "Icon background", "rgba(168,196,154,0.16)"],
      ["choice_background", "Choice background", ""],
      ["active_background", "Active background", ""],
      ["active_border", "Active border", "rgba(233,241,232,0.32)"],
      ["active_text", "Active text", "#F4F7F1"],
      ["shadow", "Shadow", ""],
      ["active_glow", "Active glow", ""],
    ];

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; color: var(--primary-text-color); }

        .editor { display: grid; gap: 18px; padding: 16px; }

        .section { display: grid; gap: 12px; }

        h3 { margin: 0; font-size: 16px; font-weight: 600; }

        label {
          display: grid; gap: 6px;
          font-size: 12px; color: var(--secondary-text-color);
        }

        .checkbox {
          min-height: 40px; display: flex; align-items: center;
          gap: 10px; color: var(--primary-text-color); font-size: 14px;
        }

        input, select, ha-icon-picker {
          width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box;
        }

        input, select {
          min-height: 56px; border: 0;
          border-bottom: 1px solid var(--primary-color);
          border-radius: 4px 4px 0 0;
          padding: 18px 16px 6px;
          background: var(--secondary-background-color, #303030);
          color: var(--primary-text-color);
          font: inherit; outline: none;
        }

        .checkbox input {
          width: 20px; min-height: 20px; padding: 0; border: 0;
          border-radius: 4px; background: transparent;
          accent-color: var(--primary-color);
        }

        input::placeholder { color: var(--secondary-text-color); opacity: 1; }

        input:focus, select:focus {
          border-bottom-color: var(--primary-color);
          box-shadow: inset 0 -1px 0 var(--primary-color);
        }

        .entity-combo { position: relative; }

        .entity-options {
          position: absolute; z-index: 10;
          top: calc(100% + 4px); left: 0; right: 0;
          max-height: 220px; overflow-y: auto;
          display: none; border: 0;
          border-radius: 0 0 4px 4px;
          background: var(--secondary-background-color, #303030);
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0,0,0,0.24));
        }

        .entity-combo.open .entity-options { display: block; }

        .entity-option {
          width: 100%; display: grid; gap: 2px;
          padding: 9px 12px; border: 0; border-radius: 0;
          background: transparent; color: var(--primary-text-color);
          text-align: left; font-weight: 500;
        }

        .entity-option:hover, .entity-option:focus {
          background: var(--secondary-background-color);
        }

        .entity-option[hidden] { display: none; }

        .player, .playlist-editor {
          display: grid; gap: 10px; padding: 12px;
          border: 1px solid var(--divider-color); border-radius: 12px;
        }

        .player-head {
          display: flex; align-items: center;
          justify-content: space-between; gap: 12px; font-weight: 600;
        }

        .icon-button {
          width: 36px; height: 36px;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 50%; padding: 0;
        }

        .icon-button ha-icon { width: 20px; height: 20px; }

        .grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .grid label:has(.icon-picker) {
          width: 100%; max-width: 100%; min-width: 0; overflow: hidden;
        }

        .grid .icon-picker { width: 100%; max-width: 100%; min-width: 0; }

        .playlist-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        .playlist-grid .checkbox { align-self: end; min-width: 0; }

        button {
          border: 0; border-radius: 10px; padding: 10px 12px;
          background: var(--primary-color); color: var(--text-primary-color);
          font: inherit; font-weight: 600; cursor: pointer;
        }

        .ghost { background: transparent; color: var(--error-color); }

        details {
          border: 1px solid var(--divider-color);
          border-radius: 12px; padding: 12px;
        }

        summary { cursor: pointer; font-weight: 600; }

        .details-body { margin-top: 12px; }

        .colors { display: grid; gap: 10px; margin-top: 12px; }

        hr { border: none; border-top: 1px solid var(--divider-color); margin: 4px 0; }

        p.hint {
          margin: 0; font-size: 11px;
          color: var(--secondary-text-color); line-height: 1.5;
        }

        .color-field {
          display: grid; gap: 6px;
          font-size: 12px; color: var(--secondary-text-color);
        }

        .color-input-row {
          display: grid;
          grid-template-columns: 40px 1fr auto;
          gap: 6px; align-items: center;
        }

        .color-swatch {
          width: 40px; min-height: 40px; padding: 2px;
          border: 1px solid var(--divider-color); border-radius: 6px;
          cursor: pointer; background: none;
        }

        .color-text { min-height: 40px; font-family: monospace; font-size: 12px; }

        .color-preset { min-height: 40px; min-width: 90px; font-size: 12px; }

        input[type="number"].number-input { min-height: 56px; }
      </style>

      <div class="editor">
        <div class="section">
          <h3>General</h3>
          ${this._input("Empty title", this.config.empty_title, "Ingen media")}
        </div>

        <details class="players-details" ${this._playersOpen ? "open" : ""}>
          <summary>Players</summary>
          <div class="section details-body">
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
                            ${this._input("Spotify device name", player.spotify_source_name, "e.g. Living Room Speakers")}
                            ${this._checkbox("Enable playlists for this player", player.show_playlists === true)}
                            ${this._checkbox("Show volume row", player.show_volume !== false)}
                            ${this._checkbox("Local volume tracking (unreliable state)", player.local_volume === true)}
                          </div>
                        </div>
                      `,
                    )
                    .join("")
                : `<p>No players yet.</p>`
            }
            <button class="add-player">Add Player</button>
          </div>
        </details>

        <details class="playlists-details" ${this._playlistsOpen ? "open" : ""}>
          <summary>Music Assistant</summary>
          <div class="section details-body">
            ${this._musicAssistantConfigEntryPicker()}
            ${this._checkbox("Shuffle playlists", this.config.shuffle_playlists === true)}
            <button class="load-playlists" ${this.config.music_assistant_config_entry_id ? "" : "disabled"}>
              ${this._maPlaylistLoading ? "Loading..." : "Load Music Assistant playlists"}
            </button>
            ${this._maPlaylistError ? `<p>${this._escape(this._maPlaylistError)}</p>` : ""}
            ${
              playlistOptions.length
                ? playlists.length
                  ? playlists
                      .map(
                        (playlist, index) => `
                          <div class="playlist-editor" data-index="${index}">
                            <div class="player-head">
                              <span>Playlist ${index + 1}</span>
                              <button class="ghost icon-button remove-playlist" data-index="${index}" aria-label="Remove playlist">
                                <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                              </button>
                            </div>
                            <div class="grid playlist-grid">
                              ${this._playlistSelect("Playlist", playlist.media_id || playlist.source, playlistOptions)}
                              ${this._input("Name (Optional)", playlist.name, "Uses the playlist name")}
                              ${this._iconPicker("Icon", playlist.icon || "mdi:playlist-music")}
                              ${this._input("Image URL (Optional)", playlist.image || "", "/local/my-cover.jpg")}
                            </div>
                          </div>
                        `,
                      )
                      .join("")
                  : `<p>No playlists yet.</p>`
                : `<p>Load playlists from Music Assistant before adding one.</p>`
            }
            <button class="add-playlist" ${playlistOptions.length ? "" : "disabled"}>Add Playlist</button>
          </div>
        </details>

        <details class="spotify-playlists-details" ${this._spotifyPlaylistsOpen ? "open" : ""}>
          <summary>Spotify &amp; SpotifyPlus</summary>
          <div class="section details-body">
            ${this._entityPicker("SpotifyPlus entity (media_player.spotifyplus_…)", this.config.spotify_entity, "spotify")}
            <p class="hint" style="margin-top:-4px">Must be the SpotifyPlus integration entity, not the standard Spotify integration. All SpotifyPlus service calls (transfer, shuffle, seek) require this entity.</p>
            <hr>
            ${this._numberInput("Idle timeout (minutes)", this.config.idle_timeout_minutes || 0, 0, 1440, 1)}
            <p class="hint">Collapse the card to a header strip when the player has been idle for this many minutes. 0 = disabled. Tap to expand again.</p>
            ${this._numberInput("Pause timeout (minutes)", this.config.pause_timeout_minutes || 0, 0, 1440, 1)}
            <p class="hint">Collapse when paused for this many minutes. Useful for Spotify which stays visible after stopping. 0 = disabled.</p>
            <hr>
            ${
              spotifyPlaylists.length
                ? spotifyPlaylists
                    .map(
                      (playlist, index) => `
                        <div class="playlist-editor spotify-playlist-editor" data-index="${index}">
                          <div class="player-head">
                            <span>Spotify Playlist ${index + 1}</span>
                            <button class="ghost icon-button remove-spotify-playlist" data-index="${index}" aria-label="Remove Spotify playlist">
                              <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                            </button>
                          </div>
                          <div class="grid playlist-grid">
                            ${this._input("Playlist URL", playlist.playlist_url || playlist.media_content_id || playlist.media_id, "6Rb7jA4nwb3BvKfTq9LfuH")}
                            ${this._input("Name (Optional)", playlist.name, "Uses the playlist ID")}
                            ${this._iconPicker("Icon", playlist.icon || "mdi:spotify")}
                            ${this._input("Image URL (Optional)", playlist.image || "", "/local/my-cover.jpg")}
                          </div>
                        </div>
                      `,
                    )
                    .join("")
                : `<p>No Spotify playlists yet.</p>`
            }
            <button class="add-spotify-playlist">Add Spotify Playlist</button>
            <hr>
            <h4 style="margin:8px 0 4px;font-size:14px;font-weight:600">Boolean Toggles</h4>
            <p class="hint">Add <code>input_boolean</code> entities here. Clicking the tile turns the boolean on or off. Your automations handle the actual playlist logic. When the boolean is on, the tile shows as playing.</p>
            ${
              spotifyBooleans.length
                ? spotifyBooleans.map((b, i) => `
                    <div class="boolean-editor playlist-editor" data-index="${i}">
                      <div class="player-head">
                        <span>Boolean Toggle ${i + 1}</span>
                        <button class="ghost icon-button remove-spotify-boolean" data-index="${i}" aria-label="Remove boolean toggle">
                          <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                        </button>
                      </div>
                      <div class="grid">
                        ${this._entityPicker("Boolean entity", b.entity, `bool-${i}`, ["input_boolean."])}
                        ${this._input("Name (Optional)", b.name || "", "My Playlist")}
                        ${this._iconPicker("Icon", b.icon || "mdi:toggle-switch-outline")}
                        ${this._input("Image URL (Optional)", b.image || "", "/local/my-cover.jpg")}
                      </div>
                    </div>
                  `).join("")
                : `<p>No boolean toggles yet.</p>`
            }
            <button class="add-spotify-boolean">Add Boolean Toggle</button>
          </div>
        </details>

        <details class="speaker-extras-details" ${this._speakerExtrasOpen ? "open" : ""}>
          <summary>Speaker Extras</summary>
          <div class="section details-body">
            <p class="hint">Add toggles (input_boolean) or lights to the speaker panel. They appear above or below the per-speaker volume sliders. On state uses the accent color.</p>
            ${
              speakerExtras.length
                ? speakerExtras.map((e, i) => `
                    <div class="speaker-extra-editor playlist-editor" data-index="${i}">
                      <div class="player-head">
                        <span>Extra ${i + 1}</span>
                        <button class="ghost icon-button remove-speaker-extra" data-index="${i}" aria-label="Remove extra">
                          <ha-icon icon="mdi:trash-can-outline"></ha-icon>
                        </button>
                      </div>
                      <div class="grid">
                        ${this._entityPicker("Entity (boolean or light)", e.entity || "", `extra-${i}`, ["input_boolean.", "light."])}
                        ${this._input("Name (Optional)", e.name || "", "")}
                        ${this._iconPicker("Icon", e.icon || "")}
                        ${this._select("Position", e.position || "below", [
                          { value: "below", label: "Below volume sliders" },
                          { value: "above", label: "Above volume sliders" },
                        ])}
                      </div>
                    </div>
                  `).join("")
                : `<p>No extras yet.</p>`
            }
            <button class="add-speaker-extra">Add Extra</button>
          </div>
        </details>

        <details class="options-details" ${this._optionsOpen ? "open" : ""}>
          <summary>Options</summary>
          <div class="section details-body">
            ${this._checkbox("Show volume", this.config.show_volume !== false)}
            ${this._checkbox("Show Shuffle/Repeat", this.config.show_shuffle_repeat === true)}
            ${this._checkbox("Show cover art", this.config.show_cover_art === true)}            ${this._select("Cover layout", this.config.cover_art_layout === "left" ? "left" : "center", [
              { value: "center", label: "Cover center" },
              { value: "left", label: "Cover left" },
            ])}
            ${this._numberInput("Cover art size (px)", this.config.cover_art_size || 160, 40, 800, 10)}
            ${this._input("Cover art attribute", this.config.cover_art_attribute || "entity_picture", "entity_picture")}
            <hr>
            ${this._checkbox("Show progress bar", this.config.show_progress !== false)}
            <hr>
            ${this._select("Playlist panel layout (via playlist button)", this.config.playlist_display || "grid", [
              { value: "grid", label: "Grid" },
              { value: "row", label: "Scrollable row" },
            ])}
            ${this._numberInput("Playlist grid columns", this.config.playlist_columns || 4, 1, 6, 1)}
            ${this._numberInput("Playlist image size (px)", this.config.playlist_image_size || 100, 40, 200, 10)}
            ${this._checkbox("Show playlist images", this.config.show_playlist_images !== false)}
            <hr>
            ${this._checkbox("Always static height (disable collapse)", this.config.disable_collapse === true)}
            <p class="hint">Disables idle and pause collapse entirely — the card stays at full height at all times.</p>
          </div>
        </details>

        <details class="colors-details" ${this._colorsOpen ? "open" : ""}>
          <summary>Colors</summary>
          <div class="colors">
            ${colorFields
              .map(([key, label, defaultVal]) => this._colorInput(label, colors[key] || "", defaultVal || ""))
              .join("")}
            <hr style="border-top:1px solid var(--divider-color);margin:4px 0;">
            ${this._colorInput("Shuffle active color", this.config.shuffle_active_color || "", "#A8C49A")}
            ${this._colorInput("Repeat active color", this.config.repeat_active_color || "", "#A8C49A")}
            ${this._colorInput("Progress bar color", this.config.progress_color || "", "#EAD8B5")}
          </div>
        </details>
      </div>
    `;

    // ── General ───────────────────────────────────────────────────────────
    const generalInputs = this.shadowRoot.querySelectorAll(".editor > .section:first-child input");
    generalInputs[0]?.addEventListener("change", (ev) => {
      // Allow intentionally blank title — store "" explicitly so "Ingen media" fallback is suppressed
      const val = ev.target.value;
      const config = { ...this.config };
      config.empty_title = val === "" ? "" : val.trim();
      this._fireConfigChanged(config);
    });

    // ── Options ───────────────────────────────────────────────────────────
    this.shadowRoot.querySelector(".options-details")?.addEventListener("toggle", (ev) => {
      this._optionsOpen = ev.currentTarget.open;
    });

    const optionInputs = this.shadowRoot.querySelectorAll(".options-details input");
    const optionSelects = this.shadowRoot.querySelectorAll(".options-details select");

    const optCheckboxes = this.shadowRoot.querySelectorAll(".options-details .checkbox input");
    optCheckboxes[0]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      this._setValue("show_volume", ev.target.checked ? undefined : false);
    });
    optCheckboxes[1]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      this._setValue("show_shuffle_repeat", ev.target.checked ? true : undefined);
    });
    optCheckboxes[2]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      this._setValue("show_cover_art", ev.target.checked ? true : undefined);
    });
    optCheckboxes[3]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      this._setValue("show_progress", ev.target.checked ? undefined : false);
    });
    optCheckboxes[4]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      this._setValue("show_playlist_images", ev.target.checked ? undefined : false);
    });
    optCheckboxes[5]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      this._setValue("disable_collapse", ev.target.checked ? true : undefined);
    });

    optionInputs[3]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      this._setValue("cover_art_attribute", ev.target.value.trim() || undefined);
    });

    const optNumbers = this.shadowRoot.querySelectorAll(".options-details .number-input");
    optNumbers[0]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      const num = parseInt(ev.target.value, 10);
      this._setValue("cover_art_size", !isNaN(num) && num > 0 ? num : undefined);
    });
    optNumbers[1]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      const num = parseInt(ev.target.value, 10);
      this._setValue("playlist_columns", !isNaN(num) ? num : undefined);
    });
    optNumbers[2]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      const num = parseInt(ev.target.value, 10);
      this._setValue("playlist_image_size", !isNaN(num) ? num : undefined);
    });

    optionSelects[0]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      this._setValue("cover_art_layout", ev.target.value === "left" ? "left" : undefined);
    });
    optionSelects[1]?.addEventListener("change", (ev) => {
      this._optionsOpen = true;
      this._setValue("playlist_display", ev.target.value === "row" ? "row" : undefined);
    });

    // ── Section toggles ───────────────────────────────────────────────────
    this.shadowRoot.querySelector(".players-details")?.addEventListener("toggle", (ev) => {
      this._playersOpen = ev.currentTarget.open;
    });
    this.shadowRoot.querySelector(".playlists-details")?.addEventListener("toggle", (ev) => {
      this._playlistsOpen = ev.currentTarget.open;
    });
    this.shadowRoot.querySelector(".spotify-playlists-details")?.addEventListener("toggle", (ev) => {
      this._spotifyPlaylistsOpen = ev.currentTarget.open;
    });

    // Idle/pause timeouts live in the Spotify section
    const spotifyNumbers = this.shadowRoot.querySelectorAll(".spotify-playlists-details .number-input");
    spotifyNumbers[0]?.addEventListener("change", (ev) => {
      this._spotifyPlaylistsOpen = true;
      const num = parseInt(ev.target.value, 10);
      this._setValue("idle_timeout_minutes", !isNaN(num) && num >= 0 ? num : undefined);
    });
    spotifyNumbers[1]?.addEventListener("change", (ev) => {
      this._spotifyPlaylistsOpen = true;
      const num = parseInt(ev.target.value, 10);
      this._setValue("pause_timeout_minutes", !isNaN(num) && num >= 0 ? num : undefined);
    });

    this.shadowRoot.querySelector(".playlists-details .ma-config-entry")?.addEventListener("change", (ev) => {
      this._maPlaylistOptions = [];
      this._playlistsOpen = true;
      this._setValue("music_assistant_config_entry_id", ev.target.value.trim());
    });

    this.shadowRoot.querySelector(".playlists-details .details-body > .checkbox input")?.addEventListener("change", (ev) => {
      this._playlistsOpen = true;
      this._setValue("shuffle_playlists", ev.target.checked ? true : undefined);
    });

    // ── Players ───────────────────────────────────────────────────────────
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
        option.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this._setPlayer(index, "entity", ev.currentTarget.dataset.entity);
        });
      });

      const keys = ["name", "spotify_source_name"];
      playerEl.querySelectorAll("label:not(.checkbox) > input:not(.entity-input)").forEach((input, inputIndex) => {
        input.addEventListener("change", (ev) => this._setPlayer(index, keys[inputIndex], ev.target.value.trim()));
      });

      playerEl.querySelector(".icon-picker")?.addEventListener("value-changed", (ev) => {
        this._setPlayer(index, "icon", ev.detail?.value || "");
      });

      const playerCheckboxes = playerEl.querySelectorAll(".checkbox input");
      playerCheckboxes[0]?.addEventListener("change", (ev) => {
        this._setPlayer(index, "show_playlists", ev.target.checked ? true : undefined);
      });
      playerCheckboxes[1]?.addEventListener("change", (ev) => {
        this._setPlayer(index, "show_volume", ev.target.checked ? undefined : false);
      });
      playerCheckboxes[2]?.addEventListener("change", (ev) => {
        this._setPlayer(index, "local_volume", ev.target.checked ? true : undefined);
      });
    });

    // ── Spotify entity picker ─────────────────────────────────────────────
    const spotifyEntityCombo = this.shadowRoot.querySelector(".spotify-playlists-details .entity-combo");
    if (spotifyEntityCombo) {
      const entityInput = spotifyEntityCombo.querySelector(".entity-input");
      const entityOptions = spotifyEntityCombo.querySelectorAll(".entity-option");
      entityInput?.addEventListener("focus", () => spotifyEntityCombo.classList.add("open"));
      entityInput?.addEventListener("input", (ev) => {
        spotifyEntityCombo.classList.add("open");
        const query = ev.target.value.toLowerCase();
        entityOptions.forEach((option) => {
          option.hidden = !option.textContent.toLowerCase().includes(query);
        });
      });
      entityInput?.addEventListener("change", (ev) => {
        const value = ev.target.value.trim();
        const directEntity = value.match(/(media_player\.[^) ]+)/)?.[1] || value;
        this._spotifyPlaylistsOpen = true;
        this._setValue("spotify_entity", directEntity);
      });
      entityOptions.forEach((option) => {
        option.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this._spotifyPlaylistsOpen = true;
          this._setValue("spotify_entity", ev.currentTarget.dataset.entity);
        });
      });
    }

    // ── Music Assistant playlists ─────────────────────────────────────────
    this.shadowRoot.querySelectorAll(".playlist-editor").forEach((playlistEl) => {
      if (playlistEl.classList.contains("spotify-playlist-editor")) return;
      const index = Number(playlistEl.dataset.index);

      playlistEl.querySelector(".playlist-source")?.addEventListener("change", (ev) => {
        this._playlistsOpen = true;
        this._setPlaylistFromOption(index, ev.target.value);
      });

      playlistEl.querySelector("label:not(.checkbox) > input")?.addEventListener("change", (ev) => {
        this._playlistsOpen = true;
        this._setPlaylist(index, "name", ev.target.value.trim());
      });

      const playlistTextInputs = playlistEl.querySelectorAll("label:not(.checkbox) > input:not(.entity-input)");
      playlistTextInputs[1]?.addEventListener("change", (ev) => {
        this._playlistsOpen = true;
        this._setPlaylist(index, "image", ev.target.value.trim() || undefined);
      });

      playlistEl.querySelector(".icon-picker")?.addEventListener("value-changed", (ev) => {
        this._playlistsOpen = true;
        this._setPlaylist(index, "icon", ev.detail?.value || "");
      });
    });

    // ── Spotify playlists ─────────────────────────────────────────────────
    this.shadowRoot.querySelectorAll(".spotify-playlist-editor").forEach((playlistEl) => {
      const index = Number(playlistEl.dataset.index);
      const inputs = playlistEl.querySelectorAll("label:not(.checkbox) > input");

      inputs[0]?.addEventListener("change", (ev) => {
        this._setSpotifyPlaylist(index, "playlist_url", ev.target.value.trim());
      });
      inputs[1]?.addEventListener("change", (ev) => {
        this._setSpotifyPlaylist(index, "name", ev.target.value.trim());
      });
      inputs[2]?.addEventListener("change", (ev) => {
        this._setSpotifyPlaylist(index, "image", ev.target.value.trim() || undefined);
      });

      playlistEl.querySelector(".icon-picker")?.addEventListener("value-changed", (ev) => {
        this._setSpotifyPlaylist(index, "icon", ev.detail?.value || "");
      });
    });

    // ── Remove buttons ────────────────────────────────────────────────────
    this.shadowRoot.querySelectorAll(".remove-player").forEach((button) => {
      button.addEventListener("click", (ev) => this._removePlayer(Number(ev.currentTarget.dataset.index)));
    });
    this.shadowRoot.querySelectorAll(".remove-playlist").forEach((button) => {
      button.addEventListener("click", (ev) => {
        this._playlistsOpen = true;
        this._removePlaylist(Number(ev.currentTarget.dataset.index));
      });
    });
    this.shadowRoot.querySelectorAll(".remove-spotify-playlist").forEach((button) => {
      button.addEventListener("click", (ev) => this._removeSpotifyPlaylist(Number(ev.currentTarget.dataset.index)));
    });

    // ── Boolean toggle editors ────────────────────────────────────────────────
    this.shadowRoot.querySelectorAll(".boolean-editor").forEach((boolEl) => {
      const index = Number(boolEl.dataset.index);
      const combo = boolEl.querySelector(".entity-combo");
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
        const directEntity = value.match(/(input_boolean\.[^) ]+)/)?.[1] || value;
        this._setSpotifyBoolean(index, "entity", directEntity);
      });
      entityOptions.forEach((option) => {
        option.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this._setSpotifyBoolean(index, "entity", ev.currentTarget.dataset.entity);
        });
      });

      const boolInputs = boolEl.querySelectorAll("label:not(.checkbox) > input:not(.entity-input)");
      boolInputs[0]?.addEventListener("change", (ev) => this._setSpotifyBoolean(index, "name", ev.target.value.trim()));
      boolInputs[1]?.addEventListener("change", (ev) => this._setSpotifyBoolean(index, "image", ev.target.value.trim() || undefined));

      boolEl.querySelector(".icon-picker")?.addEventListener("value-changed", (ev) => {
        this._setSpotifyBoolean(index, "icon", ev.detail?.value || "");
      });
    });

    this.shadowRoot.querySelectorAll(".remove-spotify-boolean").forEach((button) => {
      button.addEventListener("click", (ev) => this._removeSpotifyBoolean(Number(ev.currentTarget.dataset.index)));
    });
    this.shadowRoot.querySelector(".add-spotify-boolean")?.addEventListener("click", () => this._addSpotifyBoolean());

    // ── Speaker extras editors ────────────────────────────────────────────────
    this.shadowRoot.querySelectorAll(".speaker-extra-editor").forEach((extraEl) => {
      const index = Number(extraEl.dataset.index);
      const combo = extraEl.querySelector(".entity-combo");
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
        const directEntity = value.match(/((input_boolean|light)\.[^) ]+)/)?.[1] || value;
        this._setSpeakerExtra(index, "entity", directEntity);
      });
      entityOptions.forEach((option) => {
        option.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this._setSpeakerExtra(index, "entity", ev.currentTarget.dataset.entity);
        });
      });

      const extraInputs = extraEl.querySelectorAll("label:not(.checkbox) > input:not(.entity-input)");
      extraInputs[0]?.addEventListener("change", (ev) => this._setSpeakerExtra(index, "name", ev.target.value.trim()));

      extraEl.querySelector(".icon-picker")?.addEventListener("value-changed", (ev) => {
        this._setSpeakerExtra(index, "icon", ev.detail?.value || "");
      });

      extraEl.querySelector("select")?.addEventListener("change", (ev) => {
        this._setSpeakerExtra(index, "position", ev.target.value === "above" ? "above" : "below");
      });
    });

    this.shadowRoot.querySelectorAll(".remove-speaker-extra").forEach((button) => {
      button.addEventListener("click", (ev) => this._removeSpeakerExtra(Number(ev.currentTarget.dataset.index)));
    });
    this.shadowRoot.querySelector(".add-speaker-extra")?.addEventListener("click", () => this._addSpeakerExtra());

    this.shadowRoot.querySelector(".speaker-extras-details")?.addEventListener("toggle", (ev) => {
      this._speakerExtrasOpen = ev.currentTarget.open;
    });

    // ── Add buttons ───────────────────────────────────────────────────────
    this.shadowRoot.querySelector(".add-player")?.addEventListener("click", () => this._addPlayer());
    this.shadowRoot.querySelector(".add-playlist")?.addEventListener("click", () => this._addPlaylist());
    this.shadowRoot.querySelector(".add-spotify-playlist")?.addEventListener("click", () => this._addSpotifyPlaylist());
    this.shadowRoot.querySelector(".load-playlists")?.addEventListener("click", () => this._loadMusicAssistantPlaylists());

    // ── Colors ────────────────────────────────────────────────────────────
    this.shadowRoot.querySelector(".colors-details")?.addEventListener("toggle", (ev) => {
      this._colorsOpen = ev.currentTarget.open;
    });

    this.shadowRoot.querySelectorAll(".colors-details .color-field").forEach((field, idx) => {
      // First N fields are the standard colorFields (stored under config.colors)
      // The last 3 are accent fields stored as top-level config keys
      const accentKeys = ["shuffle_active_color", "repeat_active_color", "progress_color"];
      const isAccent = idx >= colorFields.length;
      const key = isAccent ? accentKeys[idx - colorFields.length] : colorFields[idx]?.[0];
      if (!key) return;
      const swatch = field.querySelector(".color-swatch");
      const text = field.querySelector(".color-text");
      const preset = field.querySelector(".color-preset");
      const apply = (val) => {
        this._colorsOpen = true;
        if (isAccent) {
          this._setValue(key, val || undefined);
        } else {
          this._setColor(key, val || undefined);
        }
      };
      swatch?.addEventListener("input", (ev) => {
        if (text) text.value = ev.target.value;
        apply(ev.target.value);
      });
      text?.addEventListener("change", (ev) => {
        const val = ev.target.value.trim();
        if (/^#[0-9a-fA-F]{3,8}$/.test(val) && swatch) swatch.value = val;
        apply(val);
      });
      preset?.addEventListener("change", (ev) => {
        const val = ev.target.value;
        if (text) text.value = val;
        if (/^#[0-9a-fA-F]{3,8}$/.test(val) && swatch) swatch.value = val;
        apply(val);
        ev.target.value = "";
      });
    });
  }
}

customElements.define("nature-media-player-card-dev-editor", NatureMediaPlayerCardEditor);
