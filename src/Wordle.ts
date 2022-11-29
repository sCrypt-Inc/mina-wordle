import {
  Field,
  SmartContract,
  state,
  State,
  method,
  Bool,
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
  static readonly N_LETTERS = 5;
  static readonly N_LETTER_BITS = 5;

  word: Field[];

  constructor(serializedWord: Field) {
    this.word = [];
    const wordBits = serializedWord.toBits();
    for (let i = 0; i < Word.N_LETTERS; i++) {
      let letterBits = [];
      for (let j = 0; j < Word.N_LETTER_BITS; j++) {
        letterBits.push(wordBits[i * Word.N_LETTER_BITS + j]);
      }
      this.word.push(Field.fromBits(letterBits)); 
    }
  }

  serialize(): Field {
    return Word.serializeRaw(this.word);
  }

  getChar(i: number): Field {
    return this.word[i];
  }
  
  hash(salt: Field): Field {
    return Poseidon.hash([salt, this.serialize()]);
  }
  
  isNone(): Bool {
    let ret = new Bool(true);
    for (let i = 0; i < Word.N_LETTERS; i++) {
      ret = ret && this.word[i].equals(Field.zero);
    }
    return ret;
  }
  
  equal(othr: Word): Bool {
    // TODO: can we just compare arrays directly?
    let ret = new Bool(true);
    for (let i = 0; i < Word.N_LETTERS; i++) {
      ret = ret && this.word[i].equals(othr.word[i]);
    }
    return ret;
  }

  static fromRaw(word: Field[]): Word {
    return new Word(this.serializeRaw(word));
  }
  
  static serializeRaw(word: Field[]): Field {
    if (word.length != Word.N_LETTERS) throw new Error("Word must be made up of 5 letters!");
    for (let i = 0; i < Word.N_LETTERS; i++) {
      if (word[i].lt(0) || word[i].gt(25)) throw new Error("Invalid char at idx " + i.toString() + "!");
    }
    let wordBits = [];
    for (let i = 0; i < Word.N_LETTERS; i++) {
      let letterBits = word[i].toBits();
      for (let j = 0; j < Word.N_LETTER_BITS; j++) {
        wordBits.push(letterBits[j]);
      }
    }
    return Field.fromBits(wordBits);
  }
}

export class Clues {
  static readonly N_CLUES = 6
  static readonly N_CLUE_LETTER_BITS = 2;

  // Values: 0 -> Grey, 1 -> Yellow, 2 -> Green
  clues = new Array<Field[]>(Clues.N_CLUES);

  constructor(serializedClues: Field) {
    let serializedCluesBits = serializedClues.toBits();
    for (let i = 0; i < Clues.N_CLUES; i++) {
      let offsetRow = i * Clues.N_CLUE_LETTER_BITS * Clues.N_CLUES;
      for (let j = 0; j < Word.N_LETTERS; j++) {
        let offsetVal = offsetRow + (j * Clues.N_CLUE_LETTER_BITS);
        this.clues[i].push(Field.fromBits([
                            serializedCluesBits[offsetVal],
                            serializedCluesBits[offsetVal + 1]
                           ]));
      }
    }
  }

  serialize(): Field {
    let cluesBits = [];
    for (let i = 0; i < Clues.N_CLUES; i++) {
      for (let j = 0; j < Word.N_LETTERS; j++) {
          let clueLetterBits = this.clues[i][j].toBits();
          for (let k = 0; k < Clues.N_CLUE_LETTER_BITS; k++) {
            cluesBits.push(clueLetterBits[k]);
          }
      }
    }
    return Field.fromBits(cluesBits);
  }

  update(solutionWord: Word, guessedWord: Word, nRow: Field) {
    let clue = new Array<Field>(Word.N_LETTERS);
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

    this.clues[Number(nRow.toBigInt())] = clue;
  }
}


export class Wordle extends SmartContract {

  @state(Field) saltCommit = State<Field>();
  @state(Field) solutionCommit = State<Field>();

  // Current row.
  @state(Field) nRow = State<Field>();
  // Clues embeded in a single field elem (we need 6 x 5 x 2 bits).
  @state(Field) clues = State<Field>();
  // True if it's the players turn to guess a word. If false it's the "houses" turn to evaluate guess.
  @state(Field) playersTurn = State<Bool>();
  // Defaults to false, set to true when the player wins.
  @state(Bool) gameFinished = State<Bool>();
  // Last guessed word embeded into a single field elem.
  @state(Field) lastGuess = State<Field>();

  @method init(salt: Field, solution: Word) {
    // TODO: Check that the solution is valid so the code generator can't create an
    // illegal game.
    //
    // Store a hash of the solution so the code generator can't change the code // in the middle of the game.
    this.saltCommit.set(salt);
    this.solutionCommit.set(solution.hash(salt));

    this.nRow.set(new Field(0));
    this.clues.set(new Field(0));
    this.playersTurn.set(new Bool(true));
    this.gameFinished.set(new Bool(false));
    this.lastGuess.set(new Field(0));
  }

  @method updateHouse(solution: Field) {
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
    Poseidon.hash([this.saltCommit.get(), solution]).assertEquals(this.solutionCommit.get());

    // Check if player guessed right word. If so finish game.
    let solutionWord = new Word(solution);
    let lastGuessWord = new Word(lastGuess);
    let rightWord = true;
    for (let i = 0; i < 5; i++) {
        rightWord = rightWord && (solutionWord.getChar(i) == lastGuessWord.getChar(i));
    }

    if (rightWord) {
        this.gameFinished.set(new Bool(true));
    }

    // Update clues.
    let cluesObj = new Clues(clues);
    cluesObj.update(solutionWord, lastGuessWord, nRow);
    this.clues.set(cluesObj.serialize());

    // Update stats.
    this.nRow.set(nRowP1);
    this.playersTurn.set(new Bool(true));
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
    this.playersTurn.set(new Bool(false));
  }
}