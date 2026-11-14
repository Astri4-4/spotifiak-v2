import Foundation
import Testing
@testable import SpotifiakCore

@Test func quizCodesComeFromCodesOrLinks() {
    #expect(quizCode(" k7q2xp ") == "K7Q2XP")
    #expect(quizCode("https://music.example/quiz/K7Q2XP") == "K7Q2XP")
    #expect(quizCode("  ") == nil)
}

@Test func quizStateDecodesARevealedRound() throws {
    let json = """
    {"id":"K7Q2XP","host":{"id":"u1","displayName":"Sacha","avatarUpdatedAt":null},
     "players":[{"id":"u1","displayName":"Sacha","avatarUpdatedAt":null,"score":800},
                {"id":"u2","displayName":"Léa","avatarUpdatedAt":null,"score":950}],
     "phase":"reveal","roundCount":10,"index":2,"remainingMs":4200.5,
     "round":{"choices":[{"title":"A","artist":"X"},{"title":"B","artist":"Y"}],"clipStart":40,"format":"opus",
              "answered":["u1","u2"],"mine":1,"answer":1,"track":null,
              "results":[{"userId":"u1","choice":1,"ms":5000,"points":875}]}}
    """
    let state = try JSONDecoder.spotifiak.decode(QuizState.self, from: Data(json.utf8))
    #expect(state.phase == .reveal)
    #expect(state.ranking.first?.displayName == "Léa")
    #expect(state.round?.answer == 1)
    #expect(state.round?.results.first?.points == 875)
}
