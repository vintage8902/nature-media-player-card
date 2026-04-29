# Nature Media Player Card

A nature-inspired Lovelace custom card for Home Assistant media players.

## Install locally

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

```yaml
type: custom:nature-media-player-card
entity: sensor.siste_aktive_mediaspiller
selector: input_select.valgt_mediaspiller
players:
  - entity: media_player.kjokken
    name: Kjøkken
    icon: mdi:stove
    option: Kjøkken
  - entity: media_player.bad_1_etg
    name: Bad 1
    icon: mdi:bathtub
    option: Bad 1. etg
  - entity: media_player.living_room
    name: Apple TV
    icon: mdi:apple
    option: Apple TV
```

`entity` can be either a media player or a sensor whose state is the active media player entity id. If a sensor is used, the card reads `media_title`, `media_artist`, `player_state`, `volume_level`, and `icon` from its attributes.

`selector` is optional. If provided, choosing a player will call `input_select.select_option`.

