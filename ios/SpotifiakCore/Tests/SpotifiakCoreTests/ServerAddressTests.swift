import Testing
@testable import SpotifiakCore

@Test(arguments: [
    ("music.example.com", ["https://music.example.com/api", "https://music.example.com", "http://music.example.com/api", "http://music.example.com"]),
    ("https://music.example.com/", ["https://music.example.com/api", "https://music.example.com"]),
    ("192.168.1.10:8080", ["https://192.168.1.10:8080/api", "https://192.168.1.10:8080", "http://192.168.1.10:8080/api", "http://192.168.1.10:8080"]),
    ("http://host/api/", ["http://host/api"]),
    (" HTTPS://Music.example.com ", ["https://music.example.com/api", "https://music.example.com"]),
    ("  ", []),
    ("ftp://host", []),
])
func candidates(input: String, expected: [String]) {
    #expect(candidateAPIBases(input).map(\.absoluteString) == expected)
}
