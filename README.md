# Nature Media Player Card

A compact, nature-inspired Lovelace custom card for Home Assistant media
players (Music Assitant, Spotify, Spotifyplus, & more). Collect multiple media players in one card, automatically follow the
latest active player, and switch between rooms with a single tap.

<p align="center">
  <img src="docs/images/cover.jpg" alt="Nature Media Player Card preview">
</p>

---

## Navigation

- [Install with HACS](#install-with-hacs)
- [Install Manually](#install-manually)
- [General Features](#general-features)
  - [Multi-player management](#multi-player-management)
  - [Playback controls](#playback-controls)
  - [Volume & local tracking](#volume--local-tracking)
  - [Cover art](#cover-art)
  - [Speaker extras](#speaker-extras)
  - [Collapse behaviour](#collapse-behaviour)
  - [Empty title](#empty-title)
  - [Colors](#colors)
- [Music Assistant](#music-assistant)
- [Spotify & SpotifyPlus](#spotify--spotifyplus)
- [Visual Editor](#visual-editor)
- [Full Example](#full-example)
- [Credits](#credits)

---

## Install With HACS

1. Open HACS in Home Assistant.
2. Go to the three-dot menu and choose **Custom repositories**.
3. Add this repository:

```text
https://github.com/vintage8902/nature-media-player-card
```

4. Choose category **Dashboard**.
5. Install **Nature Media Player Card**.
6. Reload Home Assistant or refresh your browser.

HACS should add the Lovelace resource automatically. If it does not, add it
manually:

```yaml
url: /hacsfiles/nature-media-player-card/nature-media-player-card.js
type: module
```

## Install Manually

Copy `dist/nature-media-player-card.js` to:

```text
/config/www/community/nature-media-player-card/nature-media-player-card.js
```

Add it as a Lovelace resource:

```yaml
url: /local/community/nature-media-player-card/nature-media-player-card.js
type: module
```

---

## General Features

These features apply to all configured media players regardless of platform.

### Multi-player management

No helper sensor or input select is required. The card finds the latest active
player from the `players` list and remembers the last active or manually
selected player in the browser. Tap the source icon to manually choose a
player. Starting playback or changing track on another configured player will
automatically move the card to that player. Active players are marked with a
playing badge in the player picker.

```yaml
type: custom:nature-media-player-card
players:
  - entity: media_player.kjokken
    name: Kjokken
    icon: mdi:stove
  - entity: media_player.bad_1_etg
    name: Bad 1
    icon: mdi:bathtub
  - entity: media_player.living_room
    name: Apple TV
    icon: mdi:apple
```

When you switch players, the entity you are leaving is immediately marked as
cleared so stale playing badges drop at once. Once Home Assistant's
`last_updated` for that entity advances past the point you switched, the card
trusts HA state again. This prevents speakers that don't reliably clear their
own state — such as Alexa groups — from lingering as "playing" in the panel
after you switch rooms.

### Playback controls

`show_shuffle_repeat` — defaults to `false`. Set to `true` to show independent
Shuffle and Repeat buttons around the playback controls. Shuffle toggles on/off.
Repeat cycles `off` → `all` → `one` → `off` with a distinct icon for each
state.

`show_progress` — defaults to `true`. Shows a progress bar with elapsed and
remaining time. The bar animates client-side. Tap or drag to scrub — standard
players use `media_player.media_seek`; SpotifyPlus uses
`spotifyplus.player_media_seek`. Set to `false` to hide it.

### Volume & local tracking

`show_volume` — defaults to `true`. Set to `false` to hide the volume slider
and use a shorter compact layout. Tap the volume icon to mute or unmute the
active player.

The player selector panel shows a speaker icon grid at the top, followed by a
volume row per configured player — each with icon, name, slider, and mute/unmute
button. Volume rows fire `media_player.volume_set` and `media_player.volume_mute`
directly per entity, independent of whichever player is currently active.
Players with `show_volume: false` are omitted from the rows. Unavailable or off
players are dimmed.

#### Local volume tracking

Some speakers — particularly Alexa groups — accept `volume_set` calls correctly
but don't reliably report the new volume back to Home Assistant, causing the
slider to snap back to a stale value on the next state update.

Set `local_volume: true` on a player to have the card track the last volume it
set internally, ignoring HA state for display purposes.

```yaml
players:
  - entity: media_player.living_room_group
    name: Living Room
    icon: mdi:speaker-group
    local_volume: true
```

### Cover art

`show_cover_art` — defaults to `false`. Set to `true` to show cover art
between the title/artist row and the controls. `cover_art_attribute` defaults
to `entity_picture` but can be changed if your player exposes artwork through a
different attribute. `cover_art_size` sets the pixel size of the element.

`cover_art_layout` — `"center"` (default) or `"left"`. In left layout, cover
art sits on the left with controls and volume on the right. In center layout,
`cover_art_height` controls the height of the artwork area.

### Speaker extras

`speaker_extras` renders a row of pill-shaped toggle buttons tied to
`input_boolean` or `light` entities. Buttons glow in the accent color when
their entity is `on`. Tap to call `turn_on` / `turn_off`.

```yaml
speaker_extras:
  - entity: input_boolean.bass_boost
    name: Bass
    icon: mdi:speaker-boost
    position: above
  - entity: light.shelf_strip
    name: Shelf
    icon: mdi:led-strip
    position: below
```

`position: "above"` sits between the player icon grid and the volume sliders.
`position: "below"` sits underneath the volume sliders.

### Collapse behaviour

> **⚠️ This feature is experimental and its behaviour is subject to change in a future release.**

`pause_timeout_minutes` — collapses the card to a compact 80 px header row
after the active player has been paused for this many minutes. Tap to expand.

`idle_timeout_minutes` — same behaviour, triggered when the player enters an
idle state.

`disable_collapse: true` — keeps the card at full height at all times,
ignoring both timeout settings.

### Empty title

Set `empty_title: ""` to suppress the default "Ingen media" fallback text. The
title area renders blank when no track title is available. You can also put any
string here and it will display instead.

### Colors

Every main color can be adjusted from YAML or with the visual editor color
pickers. `shuffle_active_color`, `repeat_active_color`, and `progress_color`
are top-level keys; all other colors are nested under `colors`:

```yaml
type: custom:nature-media-player-card
shuffle_active_color: "#A8C49A"
repeat_active_color: "#A8C49A"
progress_color: "#A8C49A"
colors:
  surface: rgba(60, 94, 74, 0.72)
  border: rgba(168, 196, 154, 0.13)
  accent: "#A8C49A"
  light: "#E9F1E8"
  text: "#EAD8B5"
  muted: rgba(234, 216, 181, 0.72)
  icon_background: rgba(168, 196, 154, 0.16)
  choice_background: linear-gradient(145deg, rgba(168,196,154,0.22), rgba(46,79,61,0.58))
  active_background: linear-gradient(145deg, rgba(168,196,154,0.45), rgba(233,241,232,0.18))
  active_border: rgba(233, 241, 232, 0.32)
  active_text: "#F4F7F1"
```

Optional advanced values are `shadow` and `active_glow`.

---

## Music Assistant

The card has first-class support for Music Assistant players and playlists.

### Setup

Set `music_assistant_config_entry_id` to your MA config entry ID. Enable
playlists per player with `show_playlists: true`. When the active player has
playlists enabled, a playlist button appears next to the source-icon player
picker and cycles through Music Assistant playlists → Spotify playlists →
controls. Empty groups are skipped automatically.

```yaml
type: custom:nature-media-player-card
music_assistant_config_entry_id: 01KQGB3DHD2S9Q2YAPJCWSTCYX
players:
  - entity: media_player.kjokken
    icon: mdi:stove
    show_playlists: true
playlists:
  - media_id: library://playlist/example
    name: Chill
    icon: mdi:leaf
```

In the visual editor, add your config entry ID, load playlists from Music
Assistant, add the ones you want, and tick **Enable playlists for this player**
on each player that should expose them. Playlist selections call
`music_assistant.play_media` on the active player.

`shuffle_playlists: true` — enables shuffle on the active player after a
playlist is selected.

### Playlist layout

<p align="center">
  <img src="docs/images/playlists.png" alt="Playlist panel">
</p>

`show_playlist_images` — defaults to `true`. Set to `false` to hide cover
images on tiles.

`playlist_display` — `"grid"` (default) or `"row"`. Row mode renders a
vertical scrollable list with the thumbnail on the left and the title to the
right. The card auto-sizes to show up to five rows before scrolling. Scroll
position is preserved across HA state updates.

`playlist_columns` — number of columns in grid mode. Defaults to `3`.

`playlist_image_size` — pixel size of playlist tile images.

---

## Spotify & SpotifyPlus

The card supports Spotify playback via any `media_player` Spotify integration.
For the most feature-rich experience — including reliable shuffle/repeat
control, accurate playlist matching, and position tracking — the
[SpotifyPlus](https://github.com/normcinuch/spotifyplus_ha) HACS integration
is recommended. Set `spotify_entity` to your SpotifyPlus entity
(`media_player.spotifyplus_...`).

### Setup

```yaml
type: custom:nature-media-player-card
spotify_entity: media_player.spotifyplus_your_account
players:
  - entity: media_player.kjokken
    icon: mdi:stove
    spotify_source_name: Kjøkken
spotify_playlists:
  - playlist_url: [YOUR_SPOTIFY_PLAYLIST_ID]
    name: Chill
    icon: mdi:spotify
```

Add `spotify_source_name` to each player that should receive Spotify playback —
this must match the device name as it appears in Spotify. Use a Spotify playlist
ID, URI (`spotify:playlist:...`), or full URL in `playlist_url`. Spotify
playlists are shown whenever the active player has a `spotify_source_name`,
even if Music Assistant playlists are not enabled for that player.

When a playlist is selected, the card transfers Spotify playback to the
configured source, applies shuffle/repeat via SpotifyPlus services, and starts
the playlist. Transfer is skipped when the active player is already the
SpotifyPlus entity. Shuffle and Repeat buttons also use SpotifyPlus services
when the active player is the SpotifyPlus entity.

### Boolean toggle tiles

`spotify_booleans` adds `input_boolean` tiles to the Spotify playlists panel.

This is particularly useful for accessing playlists that can't be triggered
directly through HA automations — most notably your Spotify **Liked Songs**. The idea is to
expose an `input_boolean` to a third-party voice assistant such as Amazon Alexa
and have an Alexa routine watch for it turning on, then tell Spotify to start
playing Liked Songs. Tapping the tile in the card turns the boolean on, Alexa
picks it up and triggers playback, and the tile lights up with the accent
playing badge to confirm it's active.

To automatically turn the boolean off when you switch to a different playlist,
add an automation like this:

```yaml
alias: Turn off Liked Songs when another playlist plays
triggers:
  - entity_id: media_player.YOUR_SPOTIFYPLUS_OR_SPOTIFY_ENTITY
    attribute: sp_playlist_uri
    trigger: state
actions:
  - target:
      entity_id: input_boolean.liked_songs
    action: input_boolean.turn_off
mode: single
```

```yaml
spotify_booleans:
  - entity: input_boolean.liked_songs
    name: Liked Songs
    icon: mdi:heart
    image: /local/spotify/liked.png
```

> **Known limitation:** boolean tiles always appear after regular
> `spotify_playlists` entries. User-defined ordering across the combined list
> is not yet supported.

---

## Visual Editor

The card ships with a full visual Lovelace editor. All options — players,
icons, playlists, colors, timeouts, speaker extras, and boolean toggles — can
be configured without touching YAML.

<p align="center">
  <img width="1692" height="1219" alt="Visual editor" src="https://github.com/user-attachments/assets/5d0dd1f2-e472-4449-ad57-178df5252225" />
</p>

Editor sections: **General** · **Players** · **Music Assistant** ·
**Spotify & SpotifyPlus** · **Speaker Extras** · **Options** · **Colors**

---

## Full Example

<p align="center">
  <img width="2912" height="1287" alt="Card panels overview" src="https://github.com/user-attachments/assets/22d53624-ec37-4207-b99d-dd5cf478b2c9" />
</p>

<p align="center">
  <em>Left: main playback view &nbsp;·&nbsp; Center: speaker selector with extras &nbsp;·&nbsp; Right: Spotify playlist picker</em>
</p>

The configuration shown is [Big-Xan](https://github.com/Big-Xan)'s personal
layout. He runs SpotifyPlus alongside several Alexa Echo devices and a
multi-room speaker group, which explains a few choices: `local_volume: true`
on the Alexa group (it doesn't reliably report volume state back to HA),
`spotify_source_name` on every player for seamless Spotify room switching, and
`spotify_booleans` to surface Liked Songs via an Alexa routine. The two
`speaker_extras` entries are Philips Hue sync toggles that appear as pill
buttons in the speaker panel.

Replace the `[YOUR_SPOTIFY_PLAYLIST_*]` values with your own playlist IDs,
URIs, or URLs. Local image paths like `/local/spotify/rap_gold.png` refer to
images uploaded to your HA `/config/www/` directory — replace or remove them
as needed.

```yaml
type: custom:nature-media-player-card
players:
  - entity: media_player.living_room_speakers
    icon: mdi:sofa-outline
    spotify_source_name: Living Room Speakers
    show_playlists: true
    local_volume: true
    name: Living Room
  - entity: media_player.bathroom_echo
    name: Bathroom
    spotify_source_name: Bathroom Echo
    show_playlists: true
    icon: mdi:shower
  - entity: media_player.bedroom_echo
    name: Bedroom
    spotify_source_name: Bedroom Echo
    show_playlists: true
    icon: mdi:bed-double-outline
  - entity: media_player.everywhere
    name: Everywhere
    icon: mdi:speaker
    spotify_source_name: ""
    show_playlists: true
    local_volume: true
playlists:
  - icon: hue:logo
    name: Sync Living Room
  - icon: hue:logo
    name: Sync Everywhere
spotify_playlists:
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_1]"
    name: Rap Gold
    image: /local/spotify/rap_gold.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_2]"
    name: Real Music
    icon: mdi:spotify
    image: /local/spotify/real_music.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_3]"
    name: Electronic
    icon: mdi:spotify
    image: /local/spotify/electronic.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_4]"
    name: On Repeat
    icon: mdi:spotify
    image: /local/spotify/on_repeat.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_5]"
    name: Don't Shuffle
    icon: mdi:spotify
    image: /local/spotify/dont_shuffle.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_6]"
    name: Don't Shuffle 2
    icon: mdi:spotify
    image: /local/spotify/dont_shuffle_2.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_7]"
    name: Don't Shuffle 3
    icon: mdi:spotify
    image: /local/spotify/dont_shuffle_3.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_8]"
    name: Club Mix
    icon: mdi:spotify
    image: /local/spotify/club_mix.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_9]"
    name: Workout
    icon: mdi:spotify
    image: /local/spotify/workout.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_10]"
    name: Release Radar
    icon: mdi:spotify
    image: /local/spotify/release_radar.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_11]"
    name: Spatial Audio
    icon: mdi:spotify
    image: /local/spotify/spatial_audio.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_12]"
    name: Calm Electronic
    icon: mdi:spotify
    image: /local/spotify/calm_electronic.png
  - playlist_url: "[YOUR_SPOTIFY_PLAYLIST_13]"
    name: Happy
    icon: mdi:spotify
    image: /local/spotify/happy.png
spotify_booleans:
  - entity: input_boolean.liked_songs
    name: Liked Songs
    icon: mdi:toggle-switch-outline
    image: /local/spotify/liked.png
speaker_extras:
  - entity: input_boolean.hue_music_sync_lr
    name: Sync Living Room
    icon: hue:logo
    position: below
  - entity: input_boolean.hue_music_sync_everywhere
    name: Sync Everywhere
    icon: hue:logo
    position: below
spotify_entity: media_player.spotifyplus_your_account
show_volume: true
show_cover_art: true
cover_art_layout: center
cover_art_size: 400
show_shuffle_repeat: true
show_progress: true
idle_timeout_minutes: 1
pause_timeout_minutes: 1
show_playlist_images: true
playlist_display: grid
playlist_columns: 4
playlist_image_size: 80
cover_art_attribute: entity_picture
disable_collapse: true
empty_title: "Don't judge my music :'("
colors: {}
```

---

## Credits

Special thanks to [Big-Xan](https://github.com/Big-Xan) for collaboration,
feedback, and the full example configuration.
