# Rhizz - Rhizomatic Systems Engineering

Systems Engineering tool I'm experimenting with, based on my rants about
Model-Based Systems Engineering: https://baczek.me/mbse

## Functional

- System modeling via a set of YAML files
- Interface modeling via can_encapulate and is_abstract keywords
- Verification of interface coherency via chujwieco
- Gradual typing (verification) of a system - how well is it defined?
- Allows for sketching prototypes and specify details later while preserving the
  superstructure
- Fully abstract/business level or detailed?
- Rhizz score tells you how well the system is defined

More notes: https://baczek.me/mbse/

## Non-functional

- TS-based application
- Running on local device with a file watcher
- On file changes, validate & view the system model, refresh a webpage with
  system explorer

### System description

- systems.yml
- setups.yml
- components.yml
- interfaces.yml

Those can instead be turned into a directory like systems/ once a large file
gets unwieldy.

## Implementation notes

### File watcher

- https://www.electronjs.org/docs/latest/tutorial/ipc
- https://nodejs.org/docs/latest/api/fs.html#fswatchfilename-options-listener
- https://github.com/paulmillr/chokidar
