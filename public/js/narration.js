/**
 * Shaitaan Seth's script: one source of truth for the host screen AND the
 * voice generator (tools/make-voice.js), which pre-records every `vo` line.
 *
 *   sub: on-screen subtitle (may contain {names}, {name}, {ghost}…)
 *   vo:  what the voice actually says, spelled for an Indian-English TTS voice
 *        and kept name-free so it can be recorded ahead of time.
 *
 * Voice file id for a line = `${key}_${index}` (e.g. someWrong_1).
 * Works in the browser (window.MKM_LINES) and in Node (module.exports).
 */
(function (root, factory) {
  const lines = factory();
  if (typeof module === 'object' && module.exports) module.exports = lines;
  else root.MKM_LINES = lines;
})(this, () => ({
  lobby: [
    {
      sub: 'Aaiye, aaiye! Welcome to Kaali Haveli Studios. Take out your phones and sign your contracts. In blood, preferably.',
      vo: 'Aaiye, aaiye! Welcome to Kaali Haveli Studios. Take out your phones... and sign your contracts. In blood, preferably.',
    },
    {
      sub: 'Casting call! Every star must join with the room code. Hurry, my last cast is getting cold.',
      vo: 'Casting call! Every star must join with the room code. Hurry... my last cast is getting cold.',
    },
  ],
  intro: [
    {
      sub: 'Swagat hai, mere pyaare mehmaano. I am Shaitaan Seth, producer of a thousand flops, and a few hundred funerals. Tonight we shoot my final film. Answer correctly, and you live. Answer wrongly, and you star in the climax.',
      vo: 'Swaagat hai, mere pyaare mehmaano. I am Shaitaan Seth. Producer of a thousand flops... and a few hundred funerals. Tonight, we shoot my final film. Answer correctly, and you live. Answer wrongly... and you star in the climax.',
    },
  ],
  allRight: [
    { sub: 'Sab bach gaye? Everyone survived? My coffin budget is wasted.', vo: 'Sab bach gaye? Everyone survived? My coffin budget is wasted.' },
    { sub: 'All correct. How boring. Next scene!', vo: 'All correct. How boring. Next scene!' },
    { sub: 'Wah! Full marks. Do not get comfortable.', vo: 'Waah! Full marks. Do not get comfortable.' },
  ],
  someWrong: [
    { sub: 'Galat jawab! {names}, report to the climax scene.', vo: 'Galat jawaab! Report to the climax scene.' },
    { sub: 'Oho ho ho. {names}. Wrong answer. Make-up! Prepare them for the climax.', vo: 'Oho ho ho. Wrong answer. Make-up! Prepare them for the climax.' },
    { sub: 'Tsk tsk. {names}, even my junior artists knew that one.', vo: 'Tsk, tsk. Even my junior artists knew that one.' },
  ],
  kfIntro: [
    {
      sub: 'Welcome to the climax scene. When the Shaitaan appears, slap him! But never, ever, slap Maa.',
      vo: 'Welcome to the climax scene. When the Shaitaan appears... slap him! But never... ever... slap Maa.',
    },
    {
      sub: 'Every great film needs a slap. When the Shaitaan pops up: thappad! And respect your Maa.',
      vo: 'Every great film needs a slap. When the Shaitaan pops up... thappad! And respect your Maa.',
    },
  ],
  kfIntroSingle: [
    {
      sub: 'Only you, {name}? Then beat my time of {par} seconds, or die trying. And do not slap Maa.',
      vo: 'Only one of you? Then beat my time... or die trying. And do not slap Maa.',
    },
  ],
  mgStart: [{ sub: 'Lights… camera… THAPPAD!', vo: 'Lights! Camera! Thappad!' }],
  death: [
    { sub: 'Cut! {names}. Kahani khatam. Welcome to the afterlife.', vo: 'Cut! Kahaani khatam. Welcome to the afterlife.' },
    { sub: '{names}, dead. Print it! What a performance.', vo: 'Dead. Print it! What a performance.' },
    { sub: 'Pack up for {names}. But picture abhi baaki hai. As a bhoot.', vo: 'Pack up. But picture abhi baaki hai... as a bhoot.' },
  ],
  survive: [
    { sub: 'Bach gaye! You live. For now.', vo: 'Bach gaye! You live... for now.' },
    { sub: 'Survived! Do not thank me. Thank your reflexes.', vo: 'Survived! Do not thank me. Thank your reflexes.' },
  ],
  finalIntro: [
    {
      sub: 'Picture abhi baaki hai, mere dost! This is the climax chase. The living run for the studio gate. The bhoots chase them, and steal their bodies!',
      vo: 'Picture abhi baaki hai, mere dost! This is the climax chase. The living... run for the studio gate. The bhoots... chase them, and steal their bodies!',
    },
  ],
  finalRevive: [
    {
      sub: 'Everybody is dead? Unacceptable! {name}, I give you one more take. Now run! This is the climax chase!',
      vo: 'Everybody is dead? Unacceptable! I give my best star one more take. Now run! This is the climax chase!',
    },
  ],
  possess: [
    { sub: '{ghost} has possessed {victim}!', vo: 'Possessed! The dead walk among the living!' },
    { sub: 'Body swap! {ghost} lives again, and {victim} is a bhoot!', vo: 'Body swap! A bhoot lives again!' },
  ],
  escape: [{ sub: '{name} has reached the studio gate!', vo: 'Someone has reached the studio gate!' }],
  winner: [{ sub: '{name} escapes Kaali Haveli! The hero of the film. Paisa vasool!', vo: 'The hero escapes Kaali Haveli! Paisa vasool!' }],
  timeUp: [
    {
      sub: 'Pack up! We ran out of film reels. {name} was closest to the gate. Hero by default.',
      vo: 'Pack up! We ran out of film reels. The one closest to the gate... is the hero. By default.',
    },
  ],
  nobody: [{ sub: 'Nobody escaped. Shaitaan Seth wins. As always.', vo: 'Nobody escaped. Shaitaan Seth wins. As always. Ha ha ha ha ha!' }],
  laugh: [{ sub: 'Ha ha ha ha!', vo: 'Ha ha ha ha ha... ha ha ha!' }],
}));
