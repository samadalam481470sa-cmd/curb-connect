import ARKit
import SceneKit
import SwiftUI
import simd

struct NativeMeasurementResult {
    let feet: Double
    let lidarAvailable: Bool
}

final class NativeCurbMeasureState: ObservableObject {
    @Published private(set) var points: [SIMD3<Float>] = []
    @Published var status = "Move slowly until the curb surface is tracked."
    weak var sceneView: ARSCNView?

    let lidarAvailable = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    var feet: Double {
        guard points.count >= 2 else { return 0 }
        let metres = zip(points.dropFirst(), points).reduce(Float(0)) {
            $0 + simd_distance($1.0, $1.1)
        }
        return Double(metres) * 3.280839895013123
    }

    func mark() {
        guard let scene = sceneView, let frame = scene.session.currentFrame else {
            status = "Camera session not ready."
            return
        }
        guard case .normal = frame.camera.trackingState else {
            status = "Tracking is limited. Move slowly and wait for a stable surface."
            return
        }
        let middle = CGPoint(x: scene.bounds.midX, y: scene.bounds.midY)
        guard let query = scene.raycastQuery(from: middle, allowing: .estimatedPlane,
                                             alignment: .any),
              let hit = scene.session.raycast(query).first else {
            status = "No surface under the reticle. Point at the curb or pavement."
            return
        }
        let column = hit.worldTransform.columns.3
        let point = SIMD3<Float>(column.x, column.y, column.z)
        guard point.x.isFinite, point.y.isFinite, point.z.isFinite else {
            status = "Invalid tracked point. Retry."
            return
        }
        if let last = points.last, simd_distance(last, point) > 30 {
            status = "Tracking jump detected. Restart the scan or move closer."
            return
        }
        guard points.count < 200 else {
            status = "Maximum point count reached."
            return
        }
        points.append(point)
        let sphere = SCNSphere(radius: 0.014)
        sphere.firstMaterial?.diffuse.contents = UIColor.systemCyan
        let node = SCNNode(geometry: sphere)
        node.simdPosition = point
        scene.scene.rootNode.addChildNode(node)
        status = "Point \(points.count) recorded. Aim at the next curb bend or endpoint."
    }

    func undo() {
        guard !points.isEmpty else { return }
        points.removeLast()
        sceneView?.scene.rootNode.childNodes.last?.removeFromParentNode()
        status = "Last curb point removed."
    }
    func restart() {
        points.removeAll()
        sceneView?.scene.rootNode.childNodes.forEach { $0.removeFromParentNode() }
        status = "Rescan the curb and place a starting point."
    }
}

private struct ARSceneView: UIViewRepresentable {
    @ObservedObject var model: NativeCurbMeasureState
    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.scene = SCNScene()
        view.automaticallyUpdatesLighting = true
        model.sceneView = view
        if ARWorldTrackingConfiguration.isSupported {
            let config = ARWorldTrackingConfiguration()
            config.planeDetection = [.horizontal, .vertical]
            if model.lidarAvailable { config.frameSemantics.insert(.sceneDepth) }
            view.session.run(config)
        } else {
            model.status = "ARKit world tracking isn't supported on this iPhone."
        }
        return view
    }
    func updateUIView(_ view: ARSCNView, context: Context) {}
    static func dismantleUIView(_ view: ARSCNView, coordinator: ()) {
        view.session.pause()
    }
}

struct NativeCurbARView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = NativeCurbMeasureState()
    let onComplete: (NativeMeasurementResult) -> Void

    var body: some View {
        ZStack {
            ARSceneView(model: model).ignoresSafeArea()
            Image(systemName: "plus")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(.cyan)
                .shadow(color: .black, radius: 5)
                .allowsHitTesting(false)
            VStack(alignment: .center, spacing: 12) {
                HStack {
                    Text(model.lidarAvailable ? "ARKit + LiDAR available" : "ARKit world tracking")
                    Spacer()
                    Button("Close") { dismiss() }
                }
                .font(.subheadline)
                .padding(12)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                Spacer()
                Text(model.status)
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .padding(10)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                Text(String(format: "%.2f ft  ·  %d points", model.feet, model.points.count))
                    .font(.system(.title2, design: .rounded, weight: .bold))
                    .monospacedDigit()
                    .padding(10)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                HStack(spacing: 12) {
                    Button("Mark point") { model.mark() }
                        .buttonStyle(.borderedProminent)
                    Button("Undo") { model.undo() }
                        .disabled(model.points.isEmpty)
                        .buttonStyle(.bordered)
                    Button("Reset") { model.restart() }
                        .disabled(model.points.isEmpty)
                        .buttonStyle(.bordered)
                }
                Button("Use measured length in Field Pro") {
                    onComplete(.init(feet: model.feet, lidarAvailable: model.lidarAvailable))
                }
                .disabled(model.points.count < 2 || model.feet <= 0 || model.feet > 1000)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                Text("Visible surface only · verify before bidding or cutting")
                    .font(.caption2)
                    .multilineTextAlignment(.center)
            }
            .padding(14)
        }
    }
}
