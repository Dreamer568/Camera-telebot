
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";

const API_URL = "https://YOUR-RENDER-SERVICE.onrender.com";

// Prototype only: this key can be extracted from a mobile app.
// Never put your Telegram token or Supabase service key here.
const UPLOAD_KEY = "YOUR_UPLOAD_KEY";

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
        quality: 1,
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
      quality: 1,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const mimeType = asset.mimeType || "image/jpeg";

    if (
      !["image/jpeg", "image/png", "image/webp"].includes(mimeType)
    ) {
      Alert.alert(
        "Unsupported image",
        "Choose a JPEG, PNG or WebP image."
      );
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
    setMessage("Saving image...");

    try {
      const form = new FormData();

      form.append(
        "photo",
        {
          uri: photo.uri,
          name: photo.name,
          type: photo.mimeType,
        } as any
      );

      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        headers,
        body: form,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not save the image."
        );
      }

      setMessage(
        data.duplicate
          ? "This exact image is already saved."
          : "Saved to Telegram ✓"
      );

      await loadCloudGallery(false);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Upload failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadCloudGallery(showErrors = true) {
    setLoadingGallery(true);

    try {
      const response = await fetch(
        `${API_URL}/images?limit=50`,
        { headers }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load gallery.");
      }

      setCloudImages(data.images || []);
    } catch (error) {
      if (showErrors) {
        Alert.alert(
          "Gallery",
          error instanceof Error
            ? error.message
            : "Could not load gallery."
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
        <Text style={styles.title}>Camera</Text>
        <Text style={styles.secondary}>
          Camera permission is required.
        </Text>
        <Pressable
          style={styles.primaryButton}
          onPress={requestPermission}
        >
          <Text style={styles.primaryText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

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
            {screen === "camera" ? "Library" : "Camera"}
          </Text>
        </Pressable>
      </View>

      {screen === "camera" ? (
        <>
          <View style={styles.preview}>
            {photo ? (
              <Image
                source={{ uri: photo.uri }}
                style={styles.previewImage}
              />
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

          <View style={styles.controls}>
            <Pressable
              style={styles.sideButton}
              onPress={choosePhoto}
            >
              <View style={styles.galleryIcon}>
                <Text style={styles.galleryGlyph}>▧</Text>
              </View>
              <Text style={styles.label}>Photos</Text>
            </Pressable>

            <Pressable
              style={styles.shutterOuter}
              onPress={photo ? () => setPhoto(null) : takePhoto}
              accessibilityLabel={
                photo ? "Return to camera" : "Take photo"
              }
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
            <ActivityIndicator
              color="#fff"
              style={{ marginTop: 30 }}
            />
          ) : cloudImages.length === 0 ? (
            <Text style={styles.empty}>
              No saved images yet.
            </Text>
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
                    setMessage("Cloud image selected.");
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

      <Text style={styles.footer}>
        Private Telegram image library
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  header: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
  },
  title: {
    color: "#fff",
    fontSize: 21,
    fontWeight: "600",
  },
  link: { color: "#60A5FA", fontSize: 15 },
  secondary: { color: "#aaa" },
  preview: {
    flex: 1,
    marginHorizontal: 8,
    backgroundColor: "#151515",
    borderRadius: 18,
    overflow: "hidden",
  },
  previewImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  retake: {
    position: "absolute",
    bottom: 18,
    alignSelf: "center",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: "#222D",
  },
  retakeText: { color: "#fff" },
  controls: {
    height: 124,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 16,
  },
  sideButton: {
    width: 64,
    alignItems: "center",
    gap: 7,
  },
  galleryIcon: {
    width: 46,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#aaa",
    justifyContent: "center",
    alignItems: "center",
  },
  galleryGlyph: { color: "#fff", fontSize: 27 },
  shutterOuter: {
    width: 76,
    height: 76,
    borderWidth: 5,
    borderColor: "#fff",
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 32,
    backgroundColor: "#fff",
  },
  sendCircle: {
    width: 46,
    height: 46,
    borderRadius: 24,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  sendGlyph: { color: "#000", fontSize: 29, fontWeight: "600" },
  dimmed: { opacity: 0.35 },
  label: { color: "#ddd", fontSize: 11 },
  status: {
    minHeight: 30,
    color: "#aaa",
    textAlign: "center",
    fontSize: 12,
    paddingHorizontal: 12,
  },
  library: { flex: 1 },
  grid: { padding: 3 },
  tile: {
    width: "33.333%",
    aspectRatio: 1,
    padding: 2,
  },
  tileImage: {
    width: "100%",
    height: "100%",
    borderRadius: 4,
    backgroundColor: "#191919",
  },
  empty: { color: "#888", textAlign: "center", marginTop: 50 },
  libraryFooter: {
    color: "#888",
    fontSize: 12,
    textAlign: "center",
    padding: 12,
  },
  footer: {
    color: "#555",
    fontSize: 10,
    textAlign: "center",
    paddingBottom: 10,
  },
  primaryButton: {
    backgroundColor: "#fff",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 25,
  },
  primaryText: { color: "#000", fontWeight: "600" },
});
