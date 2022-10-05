import {
  Field,
  SmartContract,
  state,
  State,
  method,
  DeployArgs,
  Permissions,
  CircuitValue,
  Poseidon,
} from 'snarkyjs';

// We need a minimum of 5 bits to represent 26 uppercase english letters.

// The alphabet can be represented by decimal values as the following:
// A -> 0
// B -> 1
// C -> 2
// D -> 3
// E -> 4
// F -> 5
// G -> 6
// H -> 7
// I -> 8
// J -> 9
// K -> 10
// L -> 11
// M -> 12
// N -> 13
// O -> 14
// P -> 15
// Q -> 16
// R -> 17
// S -> 18
// T -> 19
// U -> 20
// V -> 21
// W -> 22
// X -> 23
// Y -> 24
// Z -> 25

export class Word {
  const N_LETTERS = 5;
  const N_LETTER_BITS = 5;

  word: Field[];

  constructor(serializedWord: Field) {
    const wordBits = serializedWord.toBits();
    for (let i = 0; i < N_LETTERS; i++) {
      let letterBits = [];
      for (let j = 0; j < N_LETTER_BITS; j++) {
        letterBits.push(wordBits[i*N_LETTER_BITS + j]);
      }
      this.word.push(Field.ofBits(letterBits)); 
    }
  }

  serialize(): Field {
    let wordBits = [];
    for (let i = 0; i < N_LETTERS; i++) {
      let letterBits = this.word[i].toBits();
      for (let j = 0; j < N_LETTER_BITS; j++) {
        wordBits.push(letterBits[j]);
      }
    }
    return Field.ofBits(wordBits);
  }

  getChar(i: Field): Field {
    return this.word[i.toConstant];
  }
}

export class Clues {
  const N_CLUES = 6
  const N_CLUE_LETTER_BITS = 2;

  // Values: 0 -> Grey, 1 -> Yellow, 2 -> Green
  clues: Field[N_CLUES][];

  constructor(serializedClues: Field) {
    for (let i = 0; i < N_CLUES; i++) {
      let offsetRow = i * N_CLUE_LETTER_BITS * N_CLUES;
      for (let j = 0; j < Word.N_LETTERS; j++) {
        let offsetVal = offsetRow + (j * N_CLUE_LETTER_BITS);
        this.clues[i].push(Field.ofBits([
                            serializedClues[offsetVal],
                            serializedClues[offsetVal + 1]
                           ]));
      }
    }
  }

  serialize(): Field {
    let cluesBits = [];
    for (let i = 0; i < N_CLUES; i++) {
      for (let j = 0; j < Word.N_LETTERS; j++) {
          let clueLetterBits = this.clues[i][j].toBits();
          for (let k = 0; k < N_CLUE_LETTER_BITS; k++) {
            cluesBits.push(clueLetterBits[k]);
          }
      }
    }
    return Field.ofBits(cluesBits);
  }

  update(solutionWord: Word, guessedWord: Word, nRow: Field) {
    let clue = Field[Word.N_LETTERS];
    for (let i = 0; i < Word.N_LETTERS; i++) {
      for (let j = 0; j < Word.N_LETTERS; j++) {
        if (guessedWord.getChar(i) == solutionWord.getChar(j)) {
          // Mark yellow (1)
          clue[i] = new Field(1)
        }
      }
      
      if (guessedWord.getChar(i) == solutionWord.getChar(i)) {
        // Mark green (2) 
        clue[i] = new Field(2);
      }
    }

    this.clues[nRow] = clue;
  }
}


export class Wordle extends SmartContract {

  const saltCommit = new Field(12345); // TODO
  const solutionCommit = new Field(1234);  // TODO: Store as state?

  // Current row.
  @state(Field) nRow = State<Field>();
  // Clues embeded in a single field elem (we need 6 x 5 x 2 bits).
  @state(Field) clues = State<Field>();
  // True if it's the players turn to guess a word. If false it's the "houses" turn to evaluate guess.
  @state(Field) playersTurn = State<Bool>();
  // Defaults to false, set to true when the player wins.
  @state(Bool) gameFinished = State<Bool>();
  // Last guessed word embeded into a single field elem.
  @state(Field) lastGuess = State<Bool>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });

    this.nRow.set(new Field(0));
    this.clues.set(new Field(0));
    this.playersTurn.set(new Bool(true));
    this.gameFinished.set(new Bool(false));
    this.lastGuess.set(new Field(0));
  }

  @method updateHouse(solition: Field) {
    // If the game is already finished, abort.
    const finished = this.gameFinished.get();
    this.gameFinished.assertEquals(finished); // precondition that links this.gameDone.get() to the actual on-chain state
    finished.assertEquals(false);

    // Check if it's the houses turn.
    const playersTurn = this.playersTurn.get();
    this.playersTurn.assertEquals(playersTurn);
    playersTurn.assertEquals(false);

    // Get other things from SC's state.
    const lastGuess = this.lastGuess.get();
    this.lastGuess.assertEquals(lastGuess);
    const clues = this.clues.get();
    this.clues.assertEquals(clues);

    // Check if nRow + 1 > 5. If so finish game.
    const nRow = this.nRow.get();
    this.nRow.assertEquals(nRow);

    const nRowP1 = nRow.add(1);
    nRowP1.assertLte(5);

    // Check validity of solution via commitment.
    Poseidon.hash([saltCommit, solution]).assertEquals(solutionCommit);

    // Check if player guessed right word. If so finish game.
    let solutionWord = new Word(solution);
    let lastGuessWord = new Word(lastGuess);
    let rightWord = true;
    for (let i = 0; i < 5; i++) {
        rightWord = rightWord && (solutionWord.getChar(i) == lastGuessWord.getChar(i));
    }

    if (rightWord) {
        this.gameFinished.set(true);
    }

    // Update clues.
    let cluesObj = new Clues(clues);
    cluesObj.update(solutionWord, lastGuessWord, nRow);
    this.clues.set(cluesObj.serialize());

    // Update stats.
    this.nRow.set(nRowP1);
    this.playersTurn.set(true);
  }

  @method updatePlayer(guess: Field) {
    // If the game is already finished, abort.
    const finished = this.gameFinished.get();
    this.gameFinished.assertEquals(finished); // precondition that links this.gameDone.get() to the actual on-chain state
    finished.assertEquals(false);

    // Check if players turn.
    const playersTurn = this.playersTurn.get();
    this.playersTurn.assertEquals(playersTurn);
    playersTurn.assertEquals(true);

    // TODO: Check if guess is of valid format?

    // Update lastGuess and stats.
    this.lastGuess.set(guess);
    this.playersTurn.set(false);
  }
}
