<h1 align="center">
  <img src="favicon.svg" alt="" width="64"><br>
  Wend Pro
</h1>

Word path puzzles in the style of LinkedIn's Wend, generated endlessly in the browser. Trace hidden words through a grid of letters. Every letter belongs to exactly one word.

Check it out here: https://joshuaswanson.github.io/wend-pro/

## Modes

- **Difficulty**: Easy (4×4), Medium (5×5), Hard (6×6).
- **Languages**: English, French, German, and Züritüütsch (Zürich Swiss German).
- **Mixed**: equal numbers of English, French, and German words in one board.
- **Cursed**: portals that link two tiles, and fogged tiles that stay hidden until a neighbouring word is found.

## How puzzles are made

1. A random Hamiltonian path through the grid is sampled with backbite moves. In cursed mode the portal links are extra edges in the graph.
2. The path is cut into word-length segments, with a few cells left blank.
3. Each segment gets a random word of that length from the word lists in `words/`.

The puzzle number is the random seed, so a number always gives the same board, and the URL links to it. While you play, a backtracking solver accepts a hidden word traced along a different route as long as the rest of the board can still be filled.

No build step. Open `index.html` in a browser.
