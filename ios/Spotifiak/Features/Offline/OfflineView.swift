import SpotifiakCore
import SwiftUI

/// The tracks kept on the device: they play without the server.
struct OfflineView: View {
    @Environment(OfflineStore.self) private var offline

    var body: some View {
        Group {
            if offline.tracks.isEmpty {
                ContentUnavailableView(
                    "Aucun titre téléchargé",
                    systemImage: "arrow.down.circle",
                    description: Text("Touchez la flèche d'un album, d'une playlist ou des titres likés pour les écouter sans connexion.")
                )
            } else {
                DetailPage(background: AnyShapeStyle(LinearGradient(colors: [Theme.green.opacity(0.5), Theme.base], startPoint: .top, endPoint: .bottom)),
                           tracks: offline.tracks) {
                    Image(systemName: "arrow.down.circle.fill")
                        .font(.system(size: 96))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.green.opacity(0.6))
                } info: {
                    Text("Téléchargés").font(.title2.bold())
                    Text(OfflineView.status(offline)).font(.caption).foregroundStyle(Theme.subdued)
                }
            }
        }
    }

    /// "12 titres", or "12 titres • 3 en cours" while downloading.
    static func status(_ offline: OfflineStore) -> String {
        offline.remaining > 0 ? "\(trackCount(offline.tracks.count)) • \(offline.remaining) en cours" : trackCount(offline.tracks.count)
    }
}

/// The download arrow of an album, a playlist or the liked tracks.
struct OfflineToggle: View {
    let collection: Offline.Collection
    @Environment(OfflineStore.self) private var offline

    var body: some View {
        let on = offline.contains(collection)
        Button { offline.toggle(collection) } label: {
            Image(systemName: on ? "arrow.down.circle.fill" : "arrow.down.circle")
                .font(.title)
                .foregroundStyle(on ? Theme.green : Theme.subdued)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(on ? "Supprimer le téléchargement" : "Télécharger pour écouter hors connexion")
    }
}
