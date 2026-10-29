import Foundation
import Testing
@testable import Spotifiak

@Test func durations() {
    #expect(formatDuration(187) == "3:07")
    #expect(formatDuration(3723) == "1:02:03")
    #expect(formatDuration(0) == "0:00")
    #expect(formatDuration(nil) == "–")
}

@Test func greetings() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Paris")!
    func at(_ hour: Int, _ minute: Int) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: 29, hour: hour, minute: minute))!
    }
    #expect(greeting(at: at(4, 59), calendar: calendar) == "Bonsoir")
    #expect(greeting(at: at(5, 0), calendar: calendar) == "Bonjour")
    #expect(greeting(at: at(11, 59), calendar: calendar) == "Bonjour")
    #expect(greeting(at: at(12, 0), calendar: calendar) == "Bon après-midi")
    #expect(greeting(at: at(18, 0), calendar: calendar) == "Bonsoir")
}
