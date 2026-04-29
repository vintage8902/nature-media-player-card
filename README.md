# Nature Media Player Card

A nature-inspired Lovelace custom card for Home Assistant media players.

## Preview

![Nature Media Player controls](docs/images/player-controls.png)

![Nature Media Player selection](docs/images/player-selection.png)

## Install Locally

Copy `dist/nature-media-player-card.js` to:

```text
/config/www/community/nature-media-player-card/nature-media-player-card.js
```

Add it as a Lovelace resource:

```yaml
url: /local/community/nature-media-player-card/nature-media-player-card.js
type: module
```

## Example

No helper sensor is required. The card can find the latest active player from
the configured `players` list and remember the last active or manually selected
player in the browser.

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

You can still use optional helpers if you want Home Assistant to keep the active
player state server-side or if you want the card's player choices to update an
`input_select`:

```yaml
type: custom:nature-media-player-card
entity: sensor.siste_aktive_mediaspiller
selector: input_select.valgt_mediaspiller
players:
  - entity: media_player.kjokken
    name: Kjokken
    icon: mdi:stove
    option: Kjokken
  - entity: media_player.bad_1_etg
    name: Bad 1
    icon: mdi:bathtub
    option: Bad 1. etg
  - entity: media_player.living_room
    name: Apple TV
    icon: mdi:apple
    option: Apple TV
```

`entity` can be either a media player or a sensor whose state is the active
media player entity id. If a sensor is used, the card reads `media_title`,
`media_artist`, `player_state`, `volume_level`, and `icon` from its attributes.

`selector` is optional. If provided, choosing a player will call
`input_select.select_option`.
