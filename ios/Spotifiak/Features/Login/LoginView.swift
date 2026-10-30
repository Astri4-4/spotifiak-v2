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
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(.white)
                    .padding(.top, 48)
                    .accessibilityHidden(true)
                Text("Des millions de titres.\nSur votre serveur.")
                    .font(.title.bold())
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 24)

                field("Adresse du serveur") {
                    TextField("", text: $serverInput, prompt: prompt("music.example.com"))
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit { run(connect) }
                }

                if let status {
                    let creating = status.needsSetup || registering
                    field("Nom d'utilisateur") {
                        TextField("", text: $username)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    field("Mot de passe") {
                        SecureField("", text: $password)
                            .textContentType(creating ? .newPassword : .password)
                    }
                    if creating {
                        field("Nom affiché") { TextField("", text: $displayName) }
                    }
                    pill(creating ? "Créer le compte" : "Se connecter") { run(creating ? register : login) }
                        .disabled(username.isEmpty || password.isEmpty)
                    if status.signupOpen && !status.needsSetup {
                        Button(registering ? "J'ai déjà un compte" : "Créer un compte") { registering.toggle() }
                            .font(.subheadline.bold())
                            .foregroundStyle(.white)
                    }
                } else {
                    pill("Continuer") { run(connect) }
                        .disabled(serverInput.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                if let error {
                    Label(error, systemImage: "exclamationmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Theme.error)
                }
            }
            .padding(.horizontal, 32)
        }
        .disabled(busy)
        .overlay { if busy { ProgressView() } }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            LinearGradient(colors: [Color(white: 0.16), .black], startPoint: .top, endPoint: .center).ignoresSafeArea()
        }
        .onAppear {
            if case .loggedOut(let input, _) = session.state { serverInput = input }
        }
    }

    private func field<Field: View>(_ label: String, @ViewBuilder content: () -> Field) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.subheadline.bold())
            content()
                .padding(.horizontal, 12)
                .frame(height: 48)
                .background(Theme.elevated, in: RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(white: 0.5)))
        }
    }

    private func prompt(_ text: String) -> Text {
        Text(text).foregroundStyle(Color(white: 0.45))
    }

    private func pill(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(Theme.green, in: Capsule())
        }
        .buttonStyle(.plain)
        .padding(.top, 8)
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
