import PhotosUI
import SpotifiakCore
import SwiftUI

/// Display name, and the password (changing it signs the other devices out).
struct AccountView: View {
    @Environment(Session.self) private var session
    @State private var displayName = ""
    @State private var current = ""
    @State private var new = ""
    @State private var confirmation = ""
    @State private var busy = false
    @State private var message: (ok: Bool, text: String)?
    @State private var photo: PhotosPickerItem?

    private var user: User? {
        if case .loggedIn(let user) = session.state { return user }
        return nil
    }

    var body: some View {
        Form {
            if let user {
                Section("Photo de profil") {
                    HStack(spacing: 20) {
                        Avatar(person: user, size: 80)
                        VStack(alignment: .leading, spacing: 12) {
                            PhotosPicker(user.avatarUpdatedAt == nil ? "Choisir une photo" : "Changer la photo",
                                         selection: $photo, matching: .images)
                            if user.avatarUpdatedAt != nil {
                                Button("Supprimer la photo", role: .destructive) { run(removePhoto) }
                            }
                        }
                        .buttonStyle(.borderless)
                        .disabled(busy)
                    }
                    .padding(.vertical, 4)
                }
                Section("Profil") {
                    LabeledContent("Nom d'utilisateur", value: user.username)
                    TextField("Nom affiché", text: $displayName)
                    Button("Enregistrer") { run(saveProfile) }
                        .disabled(busy || displayName.trimmingCharacters(in: .whitespaces).isEmpty || displayName == user.displayName)
                }
            }
            if let user, let sharing = user.shareActivity {
                Section {
                    Toggle("Partager mon activité d'écoute", isOn: Binding(get: { sharing }, set: { on in run { try await setSharing(on) } }))
                        .tint(Theme.green)
                } header: {
                    Text("Confidentialité")
                } footer: {
                    Text("Vos amis voient ce que vous écoutez et vos dernières écoutes.")
                }
            }
            Section {
                SecureField("Mot de passe actuel", text: $current).textContentType(.password)
                SecureField("Nouveau mot de passe", text: $new).textContentType(.newPassword)
                SecureField("Confirmer le nouveau mot de passe", text: $confirmation).textContentType(.newPassword)
                Button("Changer le mot de passe") { run(changePassword) }
                    .disabled(busy || current.isEmpty || new.isEmpty || confirmation.isEmpty)
            } header: {
                Text("Mot de passe")
            } footer: {
                Text("Vos autres appareils seront déconnectés.")
            }
            if let message {
                Section { Text(message.text).foregroundStyle(message.ok ? Theme.green : Theme.error) }
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Compte")
        .onAppear { displayName = user?.displayName ?? "" }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            photo = nil
            run { try await upload(item) }
        }
    }

    private func saveProfile() async throws {
        let updated = try await session.requireAPI().updateProfile(displayName: displayName.trimmingCharacters(in: .whitespaces))
        session.state = .loggedIn(updated)
        message = (true, "Profil enregistré")
    }

    /// Resizes the picked photo (see `avatarJPEG`), uploads it, then reloads the account.
    private func upload(_ item: PhotosPickerItem) async throws {
        guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
              let jpeg = avatarJPEG(image) else {
            message = (false, "Image illisible")
            return
        }
        let api = try session.requireAPI()
        _ = try await api.uploadAvatar(jpeg: jpeg)
        try await reloadUser(api)
    }

    private func removePhoto() async throws {
        let api = try session.requireAPI()
        try await api.removeAvatar()
        try await reloadUser(api)
    }

    private func reloadUser(_ api: APIClient) async throws {
        if let user = try await api.authStatus().user { session.state = .loggedIn(user) }
    }

    private func setSharing(_ on: Bool) async throws {
        session.state = .loggedIn(try await session.requireAPI().setShareActivity(on))
    }

    private func changePassword() async throws {
        guard new == confirmation else {
            message = (false, "Les deux mots de passe ne correspondent pas")
            return
        }
        try await session.requireAPI().changePassword(current: current, new: new)
        current = ""
        new = ""
        confirmation = ""
        message = (true, "Mot de passe modifié")
    }

    private func run(_ action: @escaping () async throws -> Void) {
        message = nil
        busy = true
        Task {
            defer { busy = false }
            do { try await action() } catch { message = (false, (error as? APIError)?.message ?? "Serveur injoignable") }
        }
    }
}

/// Admins: every account (role, password reset, deletion) and a form for a new one.
struct UsersView: View {
    @Environment(Session.self) private var session
    @State private var users: [ManagedUser]?
    @State private var error: String?
    @State private var username = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var role = Role.user
    @State private var resetting: ManagedUser?
    @State private var newPassword = ""
    @State private var deleting: ManagedUser?

    private var currentUserId: String? {
        if case .loggedIn(let user) = session.state { return user.id }
        return nil
    }

    var body: some View {
        Form {
            Section("Nouveau compte") {
                TextField("Nom d'utilisateur", text: $username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Mot de passe", text: $password).textContentType(.newPassword)
                TextField("Nom affiché (facultatif)", text: $displayName)
                Picker("Rôle", selection: $role) {
                    Text("Utilisateur").tag(Role.user)
                    Text("Administrateur").tag(Role.admin)
                }
                Button("Créer le compte") {
                    run {
                        try await $0.createUser(username: username, password: password, displayName: displayName, role: role)
                        username = ""
                        password = ""
                        displayName = ""
                        role = .user
                    }
                }
                .disabled(username.isEmpty || password.isEmpty)
            }

            Section(users.map { "Comptes (\($0.count))" } ?? "Comptes") {
                ForEach(users ?? []) { user in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(user.displayName).font(.headline)
                                Text("@\(user.username)" + (user.lastSeenAt.map { " • vu \($0.formatted(.relative(presentation: .named)))" } ?? ""))
                                    .font(.caption)
                                    .foregroundStyle(Theme.subdued)
                            }
                            Spacer()
                            Picker("Rôle", selection: Binding(get: { user.role }, set: { new in run { try await $0.updateUser(user.id, role: new) } })) {
                                Text("Utilisateur").tag(Role.user)
                                Text("Admin").tag(Role.admin)
                            }
                            .labelsHidden()
                        }
                        HStack(spacing: 16) {
                            Button("Nouveau mot de passe") {
                                newPassword = ""
                                resetting = user
                            }
                            Button("Supprimer", role: .destructive) { deleting = user }
                                .disabled(user.id == currentUserId)
                        }
                        .buttonStyle(.borderless)
                        .font(.subheadline)
                    }
                    .padding(.vertical, 4)
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(Theme.error) }
            }
        }
        .scrollContentBackground(.hidden)
        .navigationTitle("Comptes")
        .task { await load() }
        .alert("Nouveau mot de passe", isPresented: Binding(get: { resetting != nil }, set: { if !$0 { resetting = nil } }), presenting: resetting) { user in
            SecureField("Mot de passe", text: $newPassword)
            Button("Annuler", role: .cancel) {}
            Button("Enregistrer") { run { try await $0.updateUser(user.id, password: newPassword) } }
        } message: { user in
            Text("\(user.displayName) sera déconnecté de tous ses appareils.")
        }
        .confirmationDialog("Supprimer ce compte ?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { user in
            Button("Supprimer \(user.displayName)", role: .destructive) { run { try await $0.deleteUser(user.id) } }
        } message: { user in
            Text("Les playlists et les likes de \(user.displayName) seront perdus.")
        }
    }

    private func load() async {
        do {
            users = try await session.requireAPI().users()
        } catch {
            self.error = (error as? APIError)?.message ?? "Serveur injoignable"
        }
    }

    /// Runs an admin action, then reloads the list.
    private func run(_ action: @escaping (APIClient) async throws -> Void) {
        error = nil
        Task {
            do {
                try await action(try session.requireAPI())
            } catch {
                self.error = (error as? APIError)?.message ?? "Serveur injoignable"
            }
            await load()
        }
    }
}

// The server stores what it gets (1 MB at most): pictures are made small here.
private let avatarSide: CGFloat = 256

/// The picture's centered square, 256 px, as a JPEG.
func avatarJPEG(_ image: UIImage) -> Data? {
    let side = min(image.size.width, image.size.height)
    guard side > 0 else { return nil }
    let scale = avatarSide / side
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let rendered = UIGraphicsImageRenderer(size: CGSize(width: avatarSide, height: avatarSide), format: format).image { _ in
        // Drawn scaled so the shorter side fills the square, centered on the longer one.
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        image.draw(in: CGRect(x: (avatarSide - size.width) / 2, y: (avatarSide - size.height) / 2, width: size.width, height: size.height))
    }
    return rendered.jpegData(compressionQuality: 0.85)
}
