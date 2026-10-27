import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";

// ==========================================
// CONFIGURATION
// ==========================================
const API_URL = "https://camera-telebot.onrender.com";

// Make sure this matches your Render Environment Variable UPLOAD_KEY exactly!
const UPLOAD_KEY = "544aa0c35f1ab66261dea41c050f5935267fb878edd5c85fef6961979f55c8e5";
// ==========================================

type CloudImage = {
  sha256: string;
  filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

type SelectedPhoto = {
  uri: string;
  name: string;
  mimeType: string;
};

export default function App() {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [photo, setPhoto] = useState<SelectedPhoto | null>(null);
  const [cloudImages, setCloudImages] = useState<CloudImage[]>([]);
  const [screen, setScreen] = useState<"camera" | "gallery">("camera");
  const [loading, setLoading] = useState(false);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const [message, setMessage] = useState("");

  const headers = { "x-upload-key": UPLOAD_KEY };

  async function takePhoto() {
    try {
      if (!cameraRef.current) return;

      const result = await cameraRef.current.takePictureAsync({
        quality: 0.9,
      });

      if (result?.uri) {
        setPhoto({
          uri: result.uri,
          name: `photo-${Date.now()}.jpg`,
          mimeType: "image/jpeg",
        });
        setMessage("");
      }
    } catch {
      Alert.alert("Camera", "Could not take the photo.");
    }
  }

  async function choosePhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.9,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType || "image/jpeg";

    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      Alert.alert("Unsupported image", "Choose a JPEG, PNG or WebP image.");
      return;
    }

    const extension =
      mimeType === "image/png"
        ? "png"
        : mimeType === "image/webp"
        ? "webp"
        : "jpg";

    setPhoto({
      uri: asset.uri,
      name: asset.fileName || `photo-${Date.now()}.${extension}`,
      mimeType,
    });

    setMessage("");
    setScreen("camera");
  }

  async function sendPhoto() {
    if (!photo || loading) return;

    setLoading(true);
    setMessage("Uploading to Telegram...");

    try {
      const form = new FormData();

      // Normalize file URI format across iOS and Android
      let fileUri = photo.uri;
      if (Platform.OS === "ios" && !fileUri.startsWith("file://")) {
        fileUri = `file://${fileUri}`;
      }

      form.append("photo", {
        uri: fileUri,
        name: photo.name || `image-${Date.now()}.jpg`,
        type: photo.mimeType || "image/jpeg",
      } as any);

      // Do NOT set "Content-Type". Let fetch generate the multipart boundary.
      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        headers: {
          "x-upload-key": UPLOAD_KEY,
        },
        body: form,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.error ||
            data?.detail ||
            `Server returned status ${response.status}`
        );
      }

      setMessage(
        data.duplicate
          ? "Duplicate detected: already indexed ✓"
          : "Saved to Telegram ✓"
      );

      await loadCloudGallery(false);
    } catch (error: any) {
      console.error("Upload error details:", error);
      const isNetworkError = error?.message?.includes("fetch failed");
      setMessage(
        isNetworkError
          ? "Fetch failed: Render is waking up or URL/Key is incorrect."
          : error.message || "Upload failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadCloudGallery(showErrors = true) {
    setLoadingGallery(true);

    try {
      const response = await fetch(`${API_URL}/images?limit=50`, {
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load gallery.");
      }

      setCloudImages(data.images || []);
    } catch (error: any) {
      if (showErrors) {
        Alert.alert(
          "Gallery",
          error instanceof Error ? error.message : "Could not load gallery."
        );
      }
    } finally {
      setLoadingGallery(false);
    }
  }

  async function openGallery() {
    setScreen("gallery");
    await loadCloudGallery();
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Camera Access Required</Text>
        <Text style={styles.secondary}>
          We need your permission to access the camera to snap pictures.
        </Text>
        <Pressable style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* App Header */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {screen === "camera" ? "Camera" : "Library"}
        </Text>

        <Pressable
          onPress={() => {
            if (screen === "camera") {
              openGallery();
            } else {
              setScreen("camera");
            }
          }}
        >
          <Text style={styles.link}>
            {screen === "camera" ? "Library" : "Back to Camera"}
          </Text>
        </Pressable>
      </View>

      {screen === "camera" ? (
        <>
          {/* Viewfinder Preview */}
          <View style={styles.preview}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.previewImage} />
            ) : (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
              />
            )}

            {photo && (
              <Pressable
                style={styles.retake}
                onPress={() => {
                  setPhoto(null);
                  setMessage("");
                }}
              >
                <Text style={styles.retakeText}>Retake</Text>
              </Pressable>
            )}
          </View>

          {/* Action Bar */}
          <View style={styles.controls}>
            <Pressable style={styles.sideButton} onPress={choosePhoto}>
              <View style={styles.galleryIcon}>
                <Text style={styles.galleryGlyph}>▧</Text>
              </View>
              <Text style={styles.label}>Photos</Text>
            </Pressable>

            <Pressable
              style={styles.shutterOuter}
              onPress={photo ? () => setPhoto(null) : takePhoto}
              accessibilityLabel={photo ? "Return to camera" : "Take photo"}
            >
              <View style={styles.shutterInner} />
            </Pressable>

            <Pressable
              style={styles.sideButton}
              onPress={sendPhoto}
              disabled={!photo || loading}
            >
              <View
                style={[
                  styles.sendCircle,
                  (!photo || loading) && styles.dimmed,
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.sendGlyph}>↑</Text>
                )}
              </View>
              <Text style={styles.label}>Save</Text>
            </Pressable>
          </View>

          <Text style={styles.status}>{message || " "}</Text>
        </>
      ) : (
        <View style={styles.library}>
          {loadingGallery ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 30 }} />
          ) : cloudImages.length === 0 ? (
            <Text style={styles.empty}>No saved images in Telegram yet.</Text>
          ) : (
            <FlatList
              data={cloudImages}
              keyExtractor={(item) => item.sha256}
              numColumns={3}
              contentContainerStyle={styles.grid}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.tile}
                  onPress={() => {
                    setPhoto({
                      uri: `${API_URL}/images/${item.sha256}`,
                      name: item.filename,
                      mimeType: item.mime_type,
                    });
                    setScreen("camera");
                    setMessage("Cloud image loaded.");
                  }}
                >
                  <Image
                    source={{
                      uri: `${API_URL}/images/${item.sha256}`,
                      headers,
                    }}
                    style={styles.tileImage}
                  />
                </Pressable>
              )}
            />
          )}

          <Text style={styles.libraryFooter}>
            {cloudImages.length} indexed images
          </Text>
        </View>
      )}

      <Text style={styles.footer}>Private Telegram Storage</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  center: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },
  link: {
    color: "#60A5FA",
    fontSize: 16,
    fontWeight: "500",
  },
  secondary: {
    color: "#aaa",
    textAlign: "center",
  },
  preview: {
    flex: 1,
    marginHorizontal: 10,
    backgroundColor: "#151515",
    borderRadius: 20,
    overflow: "hidden",
  },
  previewImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  retake: {
    position: "absolute",
    bottom: 20,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 24,
    backgroundColor: "rgba(30, 30, 30, 0.8)",
  },
  retakeText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  controls: {
    height: 110,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 16,
  },
  sideButton: {
    width: 60,
    alignItems: "center",
    gap: 6,
  },
  galleryIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#888",
    justifyContent: "center",
    alignItems: "center",
  },
  galleryGlyph: {
    color: "#fff",
    fontSize: 24,
  },
  shutterOuter: {
    width: 76,
    height: 76,
    borderWidth: 4,
    borderColor: "#fff",
    borderRadius: 38,
    justifyContent: "center",
    alignItems: "center",
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#fff",
  },
  sendCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  sendGlyph: {
    color: "#000",
    fontSize: 26,
    fontWeight: "bold",
  },
  dimmed: {
    opacity: 0.35,
  },
  label: {
    color: "#ccc",
    fontSize: 12,
  },
  status: {
    minHeight: 24,
    color: "#aaa",
    textAlign: "center",
    fontSize: 13,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  library: {
    flex: 1,
  },
  grid: {
    padding: 3,
  },
  tile: {
    width: "33.333%",
    aspectRatio: 1,
    padding: 2,
  },
  tileImage: {
    width: "100%",
    height: "100%",
    borderRadius: 6,
    backgroundColor: "#191919",
  },
  empty: {
    color: "#888",
    textAlign: "center",
    marginTop: 60,
    fontSize: 15,
  },
  libraryFooter: {
    color: "#666",
    fontSize: 12,
    textAlign: "center",
    padding: 10,
  },
  footer: {
    color: "#444",
    fontSize: 11,
    textAlign: "center",
    paddingBottom: 8,
  },
  primaryButton: {
    backgroundColor: "#fff",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  primaryText: {
    color: "#000",
    fontWeight: "700",
  },
});