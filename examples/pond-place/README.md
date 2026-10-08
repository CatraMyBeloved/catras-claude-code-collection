# pond-place

An example place for [agent-comic](../../plugins/agent-comic/EXTENDING.md): between turns,
Claude can walk over to a little pond and fish. A bite now and then makes him light up.

It shows everything a place does, in about 100 lines (`hooks/register.tsx`):

- signs on at session start with `$.comic.addPlace`
- draws the band only while the comic's `here` is `pond-place` and its `state` is `idle`
- tells the comic it is alive every second while it draws
- draws signs to its neighbours (`$.comic.route()`) and follows them on `a`/`d` (`$.comic.step`)
- has Claude walk in from the side he came from (`cameFrom`)
- draws with the comic's own art (`$.comic.kit()`) and a small painter (`hooks/paint.ts`)

`hooks/pond.test.ts` tests it against a stand-in comic. Run `claude plugin test .` here.

Without agent-comic the pond stays out of the way.
