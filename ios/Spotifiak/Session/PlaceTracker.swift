import CoreLocation
import Observation
import SpotifiakCore

/// Where the iPhone is, rounded to a ~500 m cell (PlaceCell), for the "Ici" mix: plays carry the
/// cell, never the position. Read when the app comes to the front (when-in-use permission only),
/// and trusted for half an hour, while the music plays on in the background.
@MainActor @Observable
final class PlaceTracker: NSObject, CLLocationManagerDelegate {
    private(set) var cell: String?
    @ObservationIgnored private var readAt: Date?
    @ObservationIgnored private let manager = CLLocationManager()
    private static let freshness: TimeInterval = 30 * 60

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// The cell, if read recently enough to still be where the music plays.
    var current: String? {
        guard let readAt, Date().timeIntervalSince(readAt) < Self.freshness else { return nil }
        return cell
    }

    /// When the app comes to the front: asks once, then reads where the iPhone is.
    func refresh() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
        default: break
        }
    }

    // The manager calls back on the main thread, where it was created.
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let cell = PlaceCell.cell(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude)
        MainActor.assumeIsolated {
            self.cell = cell
            readAt = .now
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated { refresh() }
    }
}
