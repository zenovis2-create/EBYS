// SYNTHETIC sample conversations (fictional people). Used as text to paste into the input box and as
// the only text the sample (fixture) API can "read". The live route must work on any other text too.

export const SAMPLES = {
  sample1: {
    title: 'Clinic visit (synthetic)',
    lang: 'en',
    text: [
      'Nurse: This is Harbor Clinic calling for Mr. Lee. Can your checkup be on Friday at 10 in the morning?',
      'Mr. Lee: Friday... let me ask my daughter.',
      'Daughter: Dad, Friday does not work anymore. I will take you on Thursday. Around 3?',
      'Mr. Lee: Thursday is fine.',
      'Unknown: Take the medicine after meals.',
    ].join('\n'),
  },
  sample2: {
    title: 'Library meetup (synthetic)',
    lang: 'en',
    text: [
      'Dana: Can you meet me at the library on Tuesday at two?',
      'Sam: Two works. Actually wait, Tuesday is my physio day.',
      'Dana: No problem, Wednesday then. Same place?',
      'Sam: Wednesday at two, yes. I will bring the book.',
    ].join('\n'),
  },
  sample3: {
    title: '병원 일정 (합성)',
    lang: 'ko',
    text: [
      '간호사: 한울내과입니다. 이정수 어르신, 건강검진은 금요일 오전 10시 어떠세요?',
      '어르신: 금요일이요… 딸한테 물어볼게요.',
      '딸: 아버지, 금요일은 이제 안 돼요. 제가 목요일에 모시고 갈게요. 3시쯤 어때요?',
      '어르신: 그래, 목요일 좋다.',
      '모르는 사람: 약은 식후에 드세요.',
    ].join('\n'),
  },
};
