import { CloudFunction } from '@google-cloud/functions-framework';
import { getFirestore, DocumentData } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';
import axios from 'axios';
import { zonedTimeToUtc } from 'date-fns-tz';

// Initialize Firebase Admin
initializeApp();

// Initialize Firestore
const db = getFirestore();

interface PushNotification {
  content: string;
  link: string;
  title: string;
}

interface FirestoreDocument {
  apiKey: string;
  appId: string;
  filters: string;
  pushes: PushNotification[];
  timezone: string;
}

interface ScheduledNotification extends PushNotification {
  sendAfter: string;
}

const weeklyJob: CloudFunction = async (req, res) => {
  try {
    // 1. Get documents from Firestore
    const documents = await getDocumentsFromFirestore();
    
    // 2. Process and send notifications
    await processAndSendNotifications(documents);
    
    console.log('Weekly job completed successfully');
    res.status(200).send('Success');
  } catch (error) {
    console.error('Error executing weekly job:', error);
    res.status(500).send(error);
  }
};

async function getDocumentsFromFirestore(): Promise<FirestoreDocument[]> {
  const snapshot = await db.collection('pushes_finsearch').get();
  return snapshot.docs.map(doc => doc.data() as FirestoreDocument);
}

async function processAndSendNotifications(documents: FirestoreDocument[]) {
  for (const document of documents) {
    const { pushes, apiKey, appId, filters, timezone } = document;
    
    // Shuffle the pushes array
    const shuffledPushes = [...pushes].sort(() => Math.random() - 0.5);
    
    // Setup notification schedule
    const times = ['09:00', '12:00', '14:00', '20:00'];
    const daysAhead = 7;
    const notificationsToSend: ScheduledNotification[] = [];

    // Create schedule for next 7 days
    for (let day = 0; day < daysAhead; day++) {
      const date = new Date();
      date.setDate(date.getDate() + day + 1); // Starting tomorrow
      
      times.forEach((time, index) => {
        const push = shuffledPushes[(day * times.length) + index];
        if (push) {
          // Create date string in the document's timezone
          const dateString = `${date.toISOString().split('T')[0]}T${time}:00`;
          
          // Convert to UTC considering the timezone
          const utcDateTime = zonedTimeToUtc(dateString, timezone || 'UTC');
          
          notificationsToSend.push({
            ...push,
            sendAfter: utcDateTime.toISOString()
          });
        }
      });
    }

    // Send notifications
    await sendNotifications(notificationsToSend, apiKey, appId, filters);
  }
}

async function sendNotifications(
  notifications: ScheduledNotification[],
  apiKey: string,
  appId: string,
  filters: string
) {
  const url = 'https://onesignal.com/api/v1/notifications';
  const parsedFilters = JSON.parse(filters);

  for (const notification of notifications) {
    const message = {
      app_id: appId,
      contents: { "en": notification.content },
      headings: { "en": notification.title },
      filters: parsedFilters,
      url: notification.link,
      send_after: notification.sendAfter
    };

    try {
      await axios({
        method: 'POST',
        url: url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${apiKey}`
        },
        data: message
      });
      
      console.log(`Scheduled notification for ${notification.sendAfter}`);
    } catch (error) {
      console.error('Error sending notification:', error);
      throw error;
    }
  }
}

export { weeklyJob };
