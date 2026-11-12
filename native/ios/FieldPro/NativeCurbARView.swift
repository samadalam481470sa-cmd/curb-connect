import ARKit
import CoreVideo
import SceneKit
import SwiftUI
import simd

/// A measured length is never a survey or subsurface utility locate.
struct NativeMeasurementResult {
    let feet: Double
    let lidarAvailable: Bool
    let lidarPoints: Int
    let raycastPoints: Int
    var method: String { lidarPoints > 0 ? "arkit_lidar_depth" : "arkit_surface_raycast" }
}

private enum PointSource: Equatable {
    case lidar
    case raycast
}

private struct MarkedPoint {
    let position: SIMD3<Float>
    let source: PointSource
}

/// LiDAR samples only the *centre reticle*, which is rotation invariant. The depth buffer
/// is smaller than capturedImage. Depth represents camera-plane distance in metres.
/// Reject low-confidence/noisy readings and never claim sub-centimetre accuracy.
private enum CentreDepthSampler {
    static func point(frame: ARFrame) -> SIMD3<Float>? {
        guard let depth = frame.smoothedSceneDepth ?? frame.sceneDepth else { return nil }
        let map = depth.depthMap
        guard CVPixelBufferGetPixelFormatType(map) == kCVPixelFormatType_DepthFloat32,
              CVPixelBufferLockBaseAddress(map, .readOnly) == kCVReturnSuccess else { return nil }
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }

        let width = CVPixelBufferGetWidth(map)
        let height = CVPixelBufferGetHeight(map)
        guard width > 6, height > 6,
              let base = CVPixelBufferGetBaseAddress(map) else { return nil }
        let stride = CVPixelBufferGetBytesPerRow(map) / MemoryLayout<Float32>.stride
        let readings = base.assumingMemoryBound(to: Float32.self)
        let centreX = width / 2
        let centreY = height / 2

        let confidence = depth.confidenceMap
        var confidenceBase: UnsafeMutableRawPointer?
        var confidenceLocked = false
        var confidenceStride = 0
        var confidenceWidth = 0
        var confidenceHeight = 0
        if let confidence,
           CVPixelBufferGetPixelFormatType(confidence) == kCVPixelFormatType_OneComponent8,
           CVPixelBufferLockBaseAddress(confidence, .readOnly) == kCVReturnSuccess {
            confidenceLocked = true
            confidenceBase = CVPixelBufferGetBaseAddress(confidence)
            confidenceStride = CVPixelBufferGetBytesPerRow(confidence)
            confidenceWidth = CVPixelBufferGetWidth(confidence)
            confidenceHeight = CVPixelBufferGetHeight(confidence)
        }
        defer {
            if let confidence, confidenceLocked {
                CVPixelBufferUnlockBaseAddress(confidence, .readOnly)
            }
        }
        // If Apple supplies confidence data, use medium or high only.
        if confidence != nil && confidenceBase == nil { return nil }
        var distances: [Float32] = []
        for y in (centreY - 2)...(centreY + 2) {
            for x in (centreX - 2)...(centreX + 2) {
                let distance = readings[y * stride + x]
                guard distance.isFinite, distance >= 0.2, distance <= 8.0 else { continue }
                if let confidenceBase {
                    let cx = min(confidenceWidth - 1, x * confidenceWidth / width)
                    let cy = min(confidenceHeight - 1, y * confidenceHeight / height)
                    let quality = confidenceBase.assumingMemoryBound(to: UInt8.self)[cy * confidenceStride + cx]
                    guard Int(quality) >= ARConfidenceLevel.medium.rawValue else { continue }
                }
                distances.append(distance)
            }
        }
        guard distances.count >= 7 else { return nil }
        distances.sort()
        let median = distances[distances.count / 2]
        let close = distances.filter { abs($0 - median) < max(0.06, median * 0.035) }
        guard close.count >= 7 else { return nil }

        // Centre reticle corresponds to the optical centre in capturedImage for every rotation.
        let intrinsics = frame.camera.intrinsics
        let fx = intrinsics.columns.0.x
        let fy = intrinsics.columns.1.y
        guard fx.isFinite, fy.isFinite, fx > 0, fy > 0 else { return nil }
        let centreU = Float(frame.camera.imageResolution.width) * 0.5
        let centreV = Float(frame.camera.imageResolution.height) * 0.5
        let cameraX = ((centreU - intrinsics.columns.2.x) / fx) * median
        let cameraY = -((centreV - intrinsics.columns.2.y) / fy) * median
        let cameraPoint = SIMD4<Float>(cameraX, cameraY, -median, 1)
        let world = frame.camera.transform * cameraPoint
        let point = SIMD3<Float>(world.x, world.y, world.z)
        return point.x.isFinite && point.y.isFinite && point.z.isFinite ? point : nil
    }
}

final class NativeCurbMeasureState: ObservableObject {
    @Published private(set) var points: [SIMD3<Float>] = []
    @Published private(set) var lidarPoints = 0
    @Published private(set) var raycastPoints = 0
    @Published var status = "Move slowly until the curb surface is tracked."
    weak var sceneView: ARSCNView?
    private var sources: [PointSource] = []

    let lidarAvailable = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        || ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth)
    var feet: Double {
        guard points.count >= 2 else { return 0 }
        let metres = zip(points.dropFirst(), points).reduce(Float(0)) {
            $0 + simd_distance($1.0, $1.1)
        }
        return Double(metres) * 3.280839895013123
    }

    func mark() {
        guard let scene = sceneView, let frame = scene.session.currentFrame else {
            status = "Camera session not ready. Check camera permission and reopen the scan."
            return
        }
        guard case .normal = frame.camera.trackingState else {
            status = "Tracking is limited. Move slowly and wait for a stable surface."
            return
        }
        // Real depth, not a software imitation of LiDAR. If confidence is insufficient, use
        // ARKit world-tracked plane hit testing rather than inventing a depth value.
        var measured: MarkedPoint?
        if lidarAvailable, let depthPoint = CentreDepthSampler.point(frame: frame) {
            measured = MarkedPoint(position: depthPoint, source: .lidar)
        }
        if measured == nil {
            let middle = CGPoint(x: scene.bounds.midX, y: scene.bounds.midY)
            if let query = scene.raycastQuery(from: middle, allowing: .estimatedPlane, alignment: .any),
               let hit = scene.session.raycast(query).first {
                let column = hit.worldTransform.columns.3
                measured = MarkedPoint(position: SIMD3(column.x, column.y, column.z),
                                       source: .raycast)
            }
        }
        guard let measured else {
            status = "No reliable LiDAR depth or tracked surface. Aim at a well-lit curb or pavement."
            return
        }
        let point = measured.position
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
        sources.append(measured.source)
        if measured.source == .lidar { lidarPoints += 1 } else { raycastPoints += 1 }
        let sphere = SCNSphere(radius: 0.014)
        sphere.firstMaterial?.diffuse.contents = measured.source == .lidar
            ? UIColor.systemGreen : UIColor.systemCyan
        let node = SCNNode(geometry: sphere)
        node.name = "curb-measure-point"
        node.simdPosition = point
        scene.scene.rootNode.addChildNode(node)
        let source = measured.source == .lidar ? "LiDAR depth (medium+ confidence)" : "ARKit raycast"
        status = "Point \(points.count) measured via \(source). Aim at next curb bend."
    }

    func undo() {
        guard !points.isEmpty else { return }
        points.removeLast()
        if let source = sources.popLast() {
            if source == .lidar { lidarPoints -= 1 } else { raycastPoints -= 1 }
        }
        sceneView?.scene.rootNode.childNodes.last(where: { $0.name == "curb-measure-point" })?
            .removeFromParentNode()
        status = "Last curb point removed."
    }
    func restart() {
        points.removeAll()
        sources.removeAll()
        lidarPoints = 0
        raycastPoints = 0
        sceneView?.scene.rootNode.childNodes.filter { $0.name == "curb-measure-point" }
            .forEach { $0.removeFromParentNode() }
        status = "Rescan the curb and place a starting point."
    }

    var result: NativeMeasurementResult {
        .init(feet: feet, lidarAvailable: lidarAvailable, lidarPoints: lidarPoints,
              raycastPoints: raycastPoints)
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
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
                config.frameSemantics.insert(.smoothedSceneDepth)
            } else if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
                config.frameSemantics.insert(.sceneDepth)
            }
            view.session.run(config)
        } else {
            model.status = "ARKit world tracking isn't supported on this device."
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
                    Text(model.lidarAvailable ? "ARKit + LiDAR depth" : "ARKit surface tracking")
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
                Text("Depth: \(model.lidarPoints)  ·  Surface raycast: \(model.raycastPoints)")
                    .font(.caption)
                    .padding(8)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
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
                    onComplete(model.result)
                }
                .disabled(model.points.count < 2 || model.feet <= 0 || model.feet > 1000)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                Text("Approximate visible surface only · tape-verify before cutting or bidding")
                    .font(.caption2)
                    .multilineTextAlignment(.center)
            }
            .padding(14)
        }
    }
}
