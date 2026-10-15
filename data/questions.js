'use strict';
/**
 * ─────────────────────────────────────────────────────────────────────────
 *  Question bank for Maut Ka Mahurat.
 *
 *  Authoring format (the server shuffles options, so ALWAYS put the correct
 *  answer in `a` and the decoys in `wrong`):
 *
 *    { cat: 'Category', q: 'Question text?', a: 'Correct', wrong: ['x', 'y', 'z'] }
 *
 *  • main  → 4-option questions for the 15-second Trivia phase.
 *  • final → 2-option "this or that" questions for the rapid-fire Climax Chase.
 * ─────────────────────────────────────────────────────────────────────────
 */

const main = [
  // ── Dialogue Baazi: name the film / character behind the line ─────────
  { cat: 'Dialogue Baazi', q: '"Mogambo khush hua!" Which film gave us this villainous delight?', a: 'Mr. India', wrong: ['Karma', 'Tridev', 'Ram Lakhan'] },
  { cat: 'Dialogue Baazi', q: '"Mere paas maa hai." The ultimate mic-drop comes from which film?', a: 'Deewaar', wrong: ['Trishul', 'Zanjeer', 'Sholay'] },
  { cat: 'Dialogue Baazi', q: '"Kitne aadmi the?" Who is asking?', a: 'Gabbar Singh', wrong: ['Mogambo', 'Shakaal', 'Crime Master Gogo'] },
  { cat: 'Dialogue Baazi', q: '"Rishte mein toh hum tumhare baap lagte hain, naam hai…"', a: 'Shahenshah', wrong: ['Don', 'Vijay', 'Natwarlal'] },
  { cat: 'Dialogue Baazi', q: '"Bade bade deshon mein aisi chhoti chhoti baatein hoti rehti hain, Senorita." Which film?', a: 'Dilwale Dulhania Le Jayenge', wrong: ['Kuch Kuch Hota Hai', 'Dil To Pagal Hai', 'Kabhi Haan Kabhi Naa'] },
  { cat: 'Dialogue Baazi', q: '"Tareekh pe tareekh, tareekh pe tareekh…" thunders through which courtroom drama?', a: 'Damini', wrong: ['Ghayal', 'Ghatak', 'Border'] },
  { cat: 'Dialogue Baazi', q: '"Babumoshai, zindagi badi honi chahiye, lambi nahi." Which film?', a: 'Anand', wrong: ['Amar Prem', 'Aradhana', 'Safar'] },
  { cat: 'Dialogue Baazi', q: '"Thappad se darr nahi lagta sahab, pyaar se lagta hai." Which film?', a: 'Dabangg', wrong: ['Wanted', 'Bodyguard', 'Ready'] },
  { cat: 'Dialogue Baazi', q: 'Complete the line: "Picture abhi ____ hai, mere dost!"', a: 'baaki', wrong: ['shuru', 'khatam', 'release'] },
  { cat: 'Dialogue Baazi', q: '"How\'s the josh?" became a national chant thanks to which film?', a: 'Uri: The Surgical Strike', wrong: ['Border', 'Lakshya', 'Shershaah'] },
  { cat: 'Dialogue Baazi', q: '"Mere Karan Arjun aayenge!" Which film?', a: 'Karan Arjun', wrong: ['Ram Lakhan', 'Karz', 'Baazigar'] },
  { cat: 'Dialogue Baazi', q: 'Which character proudly declares "Main apni favourite hoon!"?', a: 'Geet', wrong: ['Simran', 'Naina', 'Poo'] },
  { cat: 'Dialogue Baazi', q: '"Aata majhi satakli!" Which cop roars this?', a: 'Singham', wrong: ['Simmba', 'Chulbul Pandey', 'Sooryavanshi'] },
  { cat: 'Dialogue Baazi', q: '"Pushpa, I hate tears." Which film?', a: 'Amar Prem', wrong: ['Anand', 'Kati Patang', 'Pushpa: The Rise'] },
  { cat: 'Dialogue Baazi', q: '"Ek chutki sindoor ki keemat tum kya jaano, Ramesh babu?" Which film?', a: 'Om Shanti Om', wrong: ['Devdas', 'Vivah', 'Hum Saath-Saath Hain'] },
  { cat: 'Dialogue Baazi', q: '"All is well" is the chant of which film?', a: '3 Idiots', wrong: ['PK', 'Lagaan', 'Dil Chahta Hai'] },

  // ── Villain Vault ──────────────────────────────────────────────────────
  { cat: 'Villain Vault', q: 'Who played the iconic Mogambo?', a: 'Amrish Puri', wrong: ['Amjad Khan', 'Prem Chopra', 'Pran'] },
  { cat: 'Villain Vault', q: 'Who played Gabbar Singh in Sholay?', a: 'Amjad Khan', wrong: ['Amrish Puri', 'Danny Denzongpa', 'Sanjeev Kumar'] },
  { cat: 'Villain Vault', q: 'The bald, cat-stroking villain Shakaal appears in which 1980 film?', a: 'Shaan', wrong: ['Shakti', 'Qurbani', 'Karz'] },
  { cat: 'Villain Vault', q: 'Which villain says "Aankhen nikal ke gotiyan khelta hoon"?', a: 'Crime Master Gogo', wrong: ['Mogambo', 'Shakaal', 'Kancha Cheena'] },
  { cat: 'Villain Vault', q: 'Who played Alauddin Khilji in Padmaavat?', a: 'Ranveer Singh', wrong: ['Ranbir Kapoor', 'Shahid Kapoor', 'Hrithik Roshan'] },
  { cat: 'Villain Vault', q: 'In Gangs of Wasseypur, who plays Faizal Khan?', a: 'Nawazuddin Siddiqui', wrong: ['Manoj Bajpayee', 'Pankaj Tripathi', 'Irrfan Khan'] },
  { cat: 'Villain Vault', q: 'In Baazigar, SRK shockingly pushes which actress\'s character off a rooftop?', a: 'Shilpa Shetty', wrong: ['Kajol', 'Juhi Chawla', 'Madhuri Dixit'] },
  { cat: 'Villain Vault', q: 'Kancha Cheena is the villain of which film (both 1990 and 2012 versions)?', a: 'Agneepath', wrong: ['Khalnayak', 'Ghayal', 'Zanjeer'] },
  { cat: 'Villain Vault', q: 'Who played Ballu, the title "Khalnayak" of 1993?', a: 'Sanjay Dutt', wrong: ['Jackie Shroff', 'Anil Kapoor', 'Sunny Deol'] },

  // ── Bhoot Bangla (horror & the supernatural) ───────────────────────────
  { cat: 'Bhoot Bangla', q: 'In Bhool Bhulaiyaa (2007), which spirit haunts the palace?', a: 'Manjulika', wrong: ['Chandramukhi', 'Mohini', 'Stree'] },
  { cat: 'Bhoot Bangla', q: 'In Stree, what do villagers write on their walls to keep the ghost away?', a: '"O Stree, kal aana"', wrong: ['"Bhoot, wapas jao"', '"Yahaan koi nahi rehta"', '"Darwaza mat kholna"'] },
  { cat: 'Bhoot Bangla', q: 'In Tumbbad, which cursed being guards the gold?', a: 'Hastar', wrong: ['Manjulika', 'Vetal', 'Pishach'] },
  { cat: 'Bhoot Bangla', q: 'Which Ram Gopal Varma horror film\'s title literally means "Ghost"?', a: 'Bhoot', wrong: ['Raat', 'Phoonk', 'Darna Mana Hai'] },
  { cat: 'Bhoot Bangla', q: 'Who plays Vicky, the small-town tailor, in Stree?', a: 'Rajkummar Rao', wrong: ['Ayushmann Khurrana', 'Varun Dhawan', 'Kartik Aaryan'] },
  { cat: 'Bhoot Bangla', q: 'The Ramsay Brothers were legendary for which genre?', a: 'Horror', wrong: ['Romance', 'Mythology', 'Dacoit westerns'] },
  { cat: 'Bhoot Bangla', q: 'In Bhool Bhulaiyaa (2007), Akshay Kumar\'s Aditya is actually a…', a: 'Psychiatrist', wrong: ['Tantrik', 'Police inspector', 'Architect'] },

  // ── Filmy Gyaan (general knowledge) ────────────────────────────────────
  { cat: 'Filmy Gyaan', q: 'India\'s first full-length feature film (1913) was…', a: 'Raja Harishchandra', wrong: ['Alam Ara', 'Kisan Kanya', 'Mother India'] },
  { cat: 'Filmy Gyaan', q: 'India\'s first sound film (1931) was…', a: 'Alam Ara', wrong: ['Raja Harishchandra', 'Devdas', 'Achhut Kanya'] },
  { cat: 'Filmy Gyaan', q: 'Which Aamir Khan film earned an Oscar nomination for Best Foreign Language Film?', a: 'Lagaan', wrong: ['Taare Zameen Par', '3 Idiots', 'Dangal'] },
  { cat: 'Filmy Gyaan', q: 'Who directed Sholay?', a: 'Ramesh Sippy', wrong: ['Yash Chopra', 'Manmohan Desai', 'Prakash Mehra'] },
  { cat: 'Filmy Gyaan', q: 'In Lagaan, the villagers play cricket to escape paying…', a: 'Land tax', wrong: ['A dowry', 'A ransom', 'A bridge toll'] },
  { cat: 'Filmy Gyaan', q: 'What is the name of the dog in Hum Aapke Hain Koun..!?', a: 'Tuffy', wrong: ['Tommy', 'Moti', 'Sheru'] },
  { cat: 'Filmy Gyaan', q: 'In 3 Idiots, Rancho\'s REAL identity is…', a: 'Phunsukh Wangdu', wrong: ['Ranchoddas Chanchad', 'Chatur Ramalingam', 'Viru Sahastrabuddhe'] },
  { cat: 'Filmy Gyaan', q: 'In Kuch Kuch Hota Hai, what is Rahul\'s daughter called?', a: 'Anjali', wrong: ['Tina', 'Pooja', 'Simran'] },
  { cat: 'Filmy Gyaan', q: 'Zindagi Na Milegi Dobara\'s road trip happens in which country?', a: 'Spain', wrong: ['Italy', 'Portugal', 'Greece'] },
  { cat: 'Filmy Gyaan', q: 'In Queen, Rani\'s solo honeymoon takes her to Paris and…', a: 'Amsterdam', wrong: ['Rome', 'Berlin', 'Prague'] },
  { cat: 'Filmy Gyaan', q: 'In Swades, Mohan Bhargava works for…', a: 'NASA', wrong: ['ISRO', 'Google', 'The United Nations'] },
  { cat: 'Filmy Gyaan', q: 'In Taare Zameen Par, little Ishaan struggles with…', a: 'Dyslexia', wrong: ['Stammering', 'Colour blindness', 'Short-term memory loss'] },
  { cat: 'Filmy Gyaan', q: 'What is the name of the alien in Koi… Mil Gaya?', a: 'Jadoo', wrong: ['Chitti', 'G.One', 'Krrish'] },
  { cat: 'Filmy Gyaan', q: 'Who played Anarkali in Mughal-e-Azam?', a: 'Madhubala', wrong: ['Meena Kumari', 'Nargis', 'Waheeda Rehman'] },
  { cat: 'Filmy Gyaan', q: 'Who played the lead in Mother India (1957)?', a: 'Nargis', wrong: ['Madhubala', 'Vyjayanthimala', 'Nutan'] },
  { cat: 'Filmy Gyaan', q: 'Dilip Kumar is popularly known as the…', a: 'Tragedy King', wrong: ['Showman', 'Angry Young Man', 'Jumping Jack'] },
  { cat: 'Filmy Gyaan', q: 'Which actor is nicknamed "Jumping Jack"?', a: 'Jeetendra', wrong: ['Mithun Chakraborty', 'Govinda', 'Rishi Kapoor'] },
  { cat: 'Filmy Gyaan', q: 'Whose trademark catchphrase is "Jhakaas!"?', a: 'Anil Kapoor', wrong: ['Jackie Shroff', 'Govinda', 'Suniel Shetty'] },
  { cat: 'Filmy Gyaan', q: 'Hrithik Roshan made his lead debut in…', a: 'Kaho Naa… Pyaar Hai', wrong: ['Koi… Mil Gaya', 'Fiza', 'Mission Kashmir'] },
  { cat: 'Filmy Gyaan', q: 'Kabir Singh is a remake of which Telugu film?', a: 'Arjun Reddy', wrong: ['Baahubali', 'Pushpa', 'Magadheera'] },
  { cat: 'Filmy Gyaan', q: 'In Andhadhun, Ayushmann\'s pianist pretends to be…', a: 'Blind', wrong: ['Deaf', 'Mute', 'Amnesiac'] },
  { cat: 'Filmy Gyaan', q: 'In Chak De! India, Kabir Khan coaches India\'s women\'s…', a: 'Hockey team', wrong: ['Cricket team', 'Football team', 'Kabaddi team'] },
  { cat: 'Filmy Gyaan', q: '"Jaadu ki jhappi" (the magic hug) is whose trademark cure?', a: 'Munna Bhai', wrong: ['Rancho', 'Circuit', 'Chatur'] },

  // ── Gaana Bajana (songs & music) ───────────────────────────────────────
  { cat: 'Gaana Bajana', q: '"Chaiyya Chaiyya" is famously danced on top of a…', a: 'Moving train', wrong: ['Double-decker bus', 'Houseboat', 'Palace rooftop'] },
  { cat: 'Gaana Bajana', q: 'A.R. Rahman won the Oscar for Best Original Song with…', a: 'Jai Ho', wrong: ['Chaiyya Chaiyya', 'Kun Faya Kun', 'Maa Tujhe Salaam'] },
  { cat: 'Gaana Bajana', q: '"Kajra Re" features in which film?', a: 'Bunty Aur Babli', wrong: ['Dhoom', 'Salaam Namaste', 'Hum Tum'] },
  { cat: 'Gaana Bajana', q: '"Apna Time Aayega" is the anthem of which film?', a: 'Gully Boy', wrong: ['Rock On!!', 'Rockstar', 'Band Baaja Baaraat'] },
  { cat: 'Gaana Bajana', q: 'A.R. Rahman\'s debut film as a composer was…', a: 'Roja', wrong: ['Bombay', 'Rangeela', 'Taal'] },
  { cat: 'Gaana Bajana', q: 'Madhuri Dixit\'s "Ek Do Teen" lit up which film?', a: 'Tezaab', wrong: ['Beta', 'Dil', 'Saajan'] },
  { cat: 'Gaana Bajana', q: 'Who sang "Mehbooba Mehbooba" in Sholay?', a: 'R.D. Burman', wrong: ['Kishore Kumar', 'Mohammed Rafi', 'Mukesh'] },
  { cat: 'Gaana Bajana', q: '"Tujhe Dekha To Yeh Jaana Sanam" plays in the mustard fields of…', a: 'Dilwale Dulhania Le Jayenge', wrong: ['Kuch Kuch Hota Hai', 'Pardes', 'Mohabbatein'] },
];

const final = [
  { cat: 'Pehle Kaun?', q: 'Which released first?', a: 'Sholay', wrong: ['DDLJ'] },
  { cat: 'Pehle Kaun?', q: 'Which released first?', a: 'Kuch Kuch Hota Hai', wrong: ['Kabhi Khushi Kabhie Gham'] },
  { cat: 'Pehle Kaun?', q: 'Which released first?', a: 'Mother India', wrong: ['Mughal-e-Azam'] },
  { cat: 'Pehle Kaun?', q: 'Which released first?', a: 'Lagaan', wrong: ['3 Idiots'] },
  { cat: 'Pehle Kaun?', q: 'Which released first?', a: 'Dil Chahta Hai', wrong: ['Zindagi Na Milegi Dobara'] },
  { cat: 'Kaun Bana?', q: 'Who played Mogambo?', a: 'Amrish Puri', wrong: ['Amjad Khan'] },
  { cat: 'Kaun Bana?', q: 'Who played Jai in Sholay?', a: 'Amitabh Bachchan', wrong: ['Dharmendra'] },
  { cat: 'Kaun Bana?', q: 'Who played Chulbul Pandey?', a: 'Salman Khan', wrong: ['Ajay Devgn'] },
  { cat: 'Kaun Bana?', q: 'Who played Bajirao in Bajirao Mastani?', a: 'Ranveer Singh', wrong: ['Ranbir Kapoor'] },
  { cat: 'Kaun Bana?', q: 'Who played Geet in Jab We Met?', a: 'Kareena Kapoor', wrong: ['Katrina Kaif'] },
  { cat: 'Kaun Bana?', q: 'Who played Rani in Queen?', a: 'Kangana Ranaut', wrong: ['Vidya Balan'] },
  { cat: 'Kaun Bana?', q: 'Who played Vidya Bagchi in Kahaani?', a: 'Vidya Balan', wrong: ['Kangana Ranaut'] },
  { cat: 'Kaun Bana?', q: 'Who played Paro in Devdas (2002)?', a: 'Aishwarya Rai', wrong: ['Madhuri Dixit'] },
  { cat: 'Kaun Bana?', q: 'Who played Rancho in 3 Idiots?', a: 'Aamir Khan', wrong: ['R. Madhavan'] },
  { cat: 'Khel Khel Mein', q: 'Lagaan is about which sport?', a: 'Cricket', wrong: ['Hockey'] },
  { cat: 'Khel Khel Mein', q: 'Chak De! India is about which sport?', a: 'Hockey', wrong: ['Kabaddi'] },
  { cat: 'Khel Khel Mein', q: 'Mary Kom is about which sport?', a: 'Boxing', wrong: ['Wrestling'] },
  { cat: 'Khel Khel Mein', q: 'Dangal is about which sport?', a: 'Wrestling', wrong: ['Boxing'] },
  { cat: 'Khel Khel Mein', q: 'Bhaag Milkha Bhaag is about…', a: 'Sprinting', wrong: ['Swimming'] },
  { cat: 'Kahaan?', q: 'Zindagi Na Milegi Dobara is set in…', a: 'Spain', wrong: ['Italy'] },
  { cat: 'Kahaan?', q: 'Kal Ho Naa Ho is set in…', a: 'New York', wrong: ['London'] },
  { cat: 'Kya Hai?', q: 'Jadoo from Koi… Mil Gaya is…', a: 'An alien', wrong: ['A robot'] },
  { cat: 'Kya Hai?', q: 'Chitti from Robot (2010) is…', a: 'A robot', wrong: ['An alien'] },
  { cat: 'Kya Hai?', q: 'Om Shanti Om\'s big twist is built on…', a: 'Reincarnation', wrong: ['Time travel'] },
  { cat: 'Kya Hai?', q: 'In Andhadhun, Akash plays the…', a: 'Piano', wrong: ['Guitar'] },
  { cat: 'Kya Hai?', q: 'The dog in Hum Aapke Hain Koun..! is…', a: 'Tuffy', wrong: ['Tommy'] },
  { cat: 'Kya Hai?', q: 'Munna Bhai\'s loyal sidekick is…', a: 'Circuit', wrong: ['Chatur'] },
  { cat: 'Kya Hai?', q: 'Basanti\'s horse in Sholay is…', a: 'Dhanno', wrong: ['Channo'] },
  { cat: 'Kya Hai?', q: 'The bounty on Gabbar Singh\'s head is…', a: '₹50,000', wrong: ['₹5,00,000'] },
  { cat: 'Kya Hai?', q: 'Tumbbad\'s cursed god is…', a: 'Hastar', wrong: ['Manjulika'] },
  { cat: 'Kisne?', q: 'Who composed "Jai Ho"?', a: 'A.R. Rahman', wrong: ['Pritam'] },
  { cat: 'Kisne?', q: 'Who directed Sholay?', a: 'Ramesh Sippy', wrong: ['Yash Chopra'] },
  { cat: 'Kisne?', q: 'Kabir Singh is a remake of a film in…', a: 'Telugu', wrong: ['Tamil'] },
  { cat: 'Kisne?', q: 'Bhool Bhulaiyaa (2007) is a remake of a film in…', a: 'Malayalam', wrong: ['Bengali'] },
];

/** Stable id for a question's pre-recorded voice file (public/audio/vo/<id>.m4a). */
const voiceId = (text) => 'q_' + require('crypto').createHash('md5').update(text).digest('hex').slice(0, 10);

module.exports = { main, final, voiceId };
