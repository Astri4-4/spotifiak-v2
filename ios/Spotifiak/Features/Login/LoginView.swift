import SpotifiakCore
import SwiftUI

/// Server address first; once the server answers, username and password (and
/// account creation when the server allows it).
struct LoginView: View {
    @Environment(Session.self) private var session

    @State private var serverInput = ""
    @State private var username = ""
    @State private var password = ""
    @State private var displayName = ""
    @State private var registering = false
    @State private var busy = false
    @State private var error: String?

    /// The server's auth status, when the address in the field is the connected one.
    private var status: AuthStatus? {
        guard case .loggedOut(let input, let status) = session.state, input == serverInput else { return nil }
        return status
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Serveur") {
                    TextField("Adresse du serveur", text: $serverInput)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit { run(connect) }
                }

                if let status {
                    let mustRegister = status.needsSetup
                    Section(mustRegister || registering ? "Créer un compte" : "Connexion") {
                        TextField("Nom d'utilisateur", text: $username)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("Mot de passe", text: $password)
                            .textContentType(mustRegister || registering ? .newPassword : .password)
                        if mustRegister || registering {
                            TextField("Nom affiché", text: $displayName)
                        }
                    }
                    Section {
                        Button(mustRegister || registering ? "Créer le compte" : "Se connecter") {
                            run(mustRegister || registering ? register : login)
                        }
                        .disabled(username.isEmpty || password.isEmpty)
                        if status.signupOpen && !mustRegister {
                            Button(registering ? "J'ai déjà un compte" : "Créer un compte") { registering.toggle() }
                        }
                    }
                } else {
                    Section {
                        Button("Continuer") { run(connect) }
                            .disabled(serverInput.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .disabled(busy)
            .overlay { if busy { ProgressView() } }
            .navigationTitle("Spotifiak")
        }
        .onAppear {
            if case .loggedOut(let input, _) = session.state { serverInput = input }
        }
    }

    private func connect() async throws {
        try await session.connect(serverInput: serverInput)
    }

    private func login() async throws {
        try await session.login(username: username, password: password)
    }

    private func register() async throws {
        try await session.register(username: username, password: password, displayName: displayName)
    }

    private func run(_ action: @escaping () async throws -> Void) {
        error = nil
        busy = true
        Task {
            defer { busy = false }
            do {
                try await action()
            } catch let apiError as APIError {
                error = apiError.message
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
